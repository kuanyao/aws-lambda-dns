'use strict';

console.log('Loading function');

const {
    ChangeResourceRecordSetsCommand,
    ListHostedZonesByNameCommand,
    ListResourceRecordSetsCommand,
    Route53Client
} = require('@aws-sdk/client-route-53');
const {
    DescribeInstancesCommand,
    EC2Client
} = require('@aws-sdk/client-ec2');

var route53 = new Route53Client({});

function normalizeTagMap(tags) {
    return (tags || []).reduce(function(acc, tag) {
        if (tag && tag.Key) {
            acc[tag.Key] = tag.Value;
        }
        return acc;
    }, {});
}

function getRecordName(detail) {
    return detail.host || detail.name;
}

function updateDnsRecord(name, domain, ipAddress) {
    var dnsEntry = name + '.' + domain;
    console.log('request to update dns record for', dnsEntry, 'ip', ipAddress || '(delete)');

    return route53.listHostedZonesByName({ DNSName: domain })
        .then(function(data) {
            var hostedZone = data.HostedZones.find(function(hz) {
                return hz.Name === domain + '.';
            });

            if (hostedZone) {
                return hostedZone.Id;
            }
        })
        .then(function(hostedZoneId) {
            if (!hostedZoneId) {
                console.log('no hostedZoneId found for ' + domain);
                return;
            }

            var params = {
                ChangeBatch: {
                    Changes: []
                },
                HostedZoneId: hostedZoneId
            };
            var change = {};

            if (!ipAddress) {
                params.ChangeBatch.Comment = 'request to delete dns record ' + dnsEntry;
                console.log(params.ChangeBatch.Comment);

                change.Action = 'DELETE';

                return route53.send(new ListResourceRecordSetsCommand({ HostedZoneId: hostedZoneId }))
                    .then(function(data) {
                        var recordSet = data.ResourceRecordSets.find(function(rs) {
                            return rs.Name === dnsEntry + '.';
                        });

                        if (recordSet) {
                            change.ResourceRecordSet = recordSet;
                            params.ChangeBatch.Changes.push(change);
                            return route53.send(new ChangeResourceRecordSetsCommand(params));
                        }

                        console.log('no existing record found for ' + dnsEntry + '; nothing to delete');
                    });
            }

            params.ChangeBatch.Comment = 'request to create/update dns record ' + dnsEntry + ' with ip address ' + ipAddress;
            console.log(params.ChangeBatch.Comment);

            change.Action = 'UPSERT';
            change.ResourceRecordSet = {
                Name: dnsEntry,
                Type: 'A',
                ResourceRecords: [{ Value: ipAddress }],
                TTL: 300
            };

            params.ChangeBatch.Changes.push(change);
            return route53.send(new ChangeResourceRecordSetsCommand(params));
        })
        .then(function(data) {
            if (data) {
                console.log('successfully updated dns record for ' + dnsEntry);
            }
        });
}

function buildDnsRequestFromNormalizedMessage(messageBody) {
    if (messageBody && messageBody.schema === 'ec2-dns-update-request' && messageBody.detail) {
        return {
            account: messageBody.account || messageBody.detail.accountId,
            region: messageBody.region || messageBody.detail.region,
            instanceId: messageBody.detail.instanceId,
            state: messageBody.detail.state,
            domain: messageBody.detail.domain,
            host: messageBody.detail.host,
            name: messageBody.detail.name,
            publicIp: messageBody.detail.publicIp
        };
    }

    return null;
}

function buildDnsRequestFromEnrichedEventBridgeMessage(messageBody) {
    if (!messageBody || messageBody.source !== 'kuanyao.ec2dns' || !messageBody.detail) {
        return null;
    }

    return {
        account: messageBody.account || messageBody.detail.accountId,
        region: messageBody.region || messageBody.detail.region,
        instanceId: messageBody.detail.instanceId,
        state: messageBody.detail.state,
        domain: messageBody.detail.domain,
        host: messageBody.detail.host,
        name: messageBody.detail.name,
        publicIp: messageBody.detail.publicIp
    };
}

function buildDnsRequestFromRawEc2Event(messageBody) {
    if (!messageBody || !messageBody.detail || !messageBody.detail['instance-id']) {
        return Promise.resolve(null);
    }

    var detail = messageBody.detail;
    var instanceId = detail['instance-id'];
    var state = detail.state;
    var ec2Region = messageBody.region;
    var ec2 = new EC2Client({ region: ec2Region });
    var params = { InstanceIds: [instanceId] };

    return ec2.send(new DescribeInstancesCommand(params))
        .then(function(data) {
            if (!data.Reservations || data.Reservations.length === 0 || data.Reservations[0].Instances.length === 0) {
                console.log('no instance found with instanceId ' + instanceId);
                return null;
            }

            var instance = data.Reservations[0].Instances[0];
            var tags = normalizeTagMap(instance.Tags);
            var domain = tags.domain;
            var host = tags.host;
            var name = host || tags.Name;

            if (!domain || !name) {
                console.log('instance is missing required domain/host tags', {
                    instanceId: instanceId,
                    region: ec2Region,
                    tags: tags
                });
                return null;
            }

            return {
                account: messageBody.account,
                region: ec2Region,
                instanceId: instanceId,
                state: state,
                domain: domain,
                host: host,
                name: name,
                publicIp: instance.PublicIpAddress
            };
        });
}

route53.listHostedZonesByName = function(params) {
    return route53.send(new ListHostedZonesByNameCommand(params));
};

function parseSnsMessage(record) {
    if (!record || !record.Sns || !record.Sns.Message) {
        return Promise.reject(new Error('Unexpected SNS event shape.'));
    }

    console.log('From SNS:', record.Sns.Message);

    var messageBody = JSON.parse(record.Sns.Message);
    var normalizedRequest = buildDnsRequestFromNormalizedMessage(messageBody);

    if (normalizedRequest) {
        return Promise.resolve(normalizedRequest);
    }

    var enrichedEventRequest = buildDnsRequestFromEnrichedEventBridgeMessage(messageBody);

    if (enrichedEventRequest) {
        return Promise.resolve(enrichedEventRequest);
    }

    return buildDnsRequestFromRawEc2Event(messageBody);
}

exports.handler = function(event, context, callback) {
    var records = (event && event.Records) || [];

    return Promise.all(records.map(parseSnsMessage))
        .then(function(requests) {
            return Promise.all(requests
                .filter(function(request) {
                    return request && request.domain && getRecordName(request);
                })
                .map(function(request) {
                    return updateDnsRecord(
                        getRecordName(request),
                        request.domain,
                        request.publicIp
                    );
                })
            );
        })
        .then(function() {
            callback(null, { ok: true });
        })
        .catch(function(error) {
            console.log(error);
            callback(error);
        });
};
