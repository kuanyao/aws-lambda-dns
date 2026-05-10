'use strict';

const {
    DescribeInstancesCommand,
    EC2Client
} = require('@aws-sdk/client-ec2');
const {
    EventBridgeClient,
    PutEventsCommand
} = require('@aws-sdk/client-eventbridge');

function getRegionFromEventBusArn(eventBusArn) {
    var parts = (eventBusArn || '').split(':');
    return parts.length > 3 ? parts[3] : null;
}

function normalizeTagMap(tags) {
    return (tags || []).reduce(function(acc, tag) {
        if (tag && tag.Key) {
            acc[tag.Key] = tag.Value;
        }
        return acc;
    }, {});
}

function buildDnsUpdateRequest(event, instance) {
    var tags = normalizeTagMap(instance.Tags);
    var domain = tags.domain;
    var host = tags.host;
    var name = host || tags.Name;

    if (!domain || !name) {
        console.log('instance is missing required domain/host tags', {
            instanceId: event.detail['instance-id'],
            region: event.region,
            tags: tags
        });
        return null;
    }

    return {
        schema: 'ec2-dns-update-request',
        account: event.account,
        region: event.region,
        detail: {
            accountId: event.account,
            region: event.region,
            instanceId: event.detail['instance-id'],
            state: event.detail.state,
            domain: domain,
            host: host,
            name: name,
            publicIp: instance.PublicIpAddress || null
        }
    };
}

exports.handler = function(event, context, callback) {
    var eventBusArn = process.env.CENTRAL_EVENT_BUS_ARN;

    if (!eventBusArn) {
        callback(new Error('Missing CENTRAL_EVENT_BUS_ARN.'));
        return;
    }

    if (!event || !event.detail || !event.detail['instance-id']) {
        callback(new Error('Unexpected EventBridge event shape.'));
        return;
    }

    var instanceId = event.detail['instance-id'];
    var ec2 = new EC2Client({ region: event.region });
    var centralBusRegion = getRegionFromEventBusArn(eventBusArn);
    var eventBridge = new EventBridgeClient({ region: centralBusRegion || event.region });

    ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))
        .then(function(data) {
            if (!data.Reservations || data.Reservations.length === 0 || data.Reservations[0].Instances.length === 0) {
                console.log('no instance found with instanceId ' + instanceId);
                return null;
            }

            return buildDnsUpdateRequest(event, data.Reservations[0].Instances[0]);
        })
        .then(function(request) {
            if (!request) {
                return null;
            }

            return eventBridge.send(new PutEventsCommand({
                Entries: [
                    {
                        EventBusName: eventBusArn,
                        Source: 'kuanyao.ec2dns',
                        DetailType: 'EC2 DNS Update Request',
                        Detail: JSON.stringify(request.detail),
                        Resources: [
                            'arn:aws:ec2:' + event.region + ':' + event.account + ':instance/' + instanceId
                        ]
                    }
                ]
            }));
        })
        .then(function(result) {
            if (result) {
                console.log('published normalized dns update event', result);
            }
            callback(null, { ok: true });
        })
        .catch(function(error) {
            console.log(error);
            callback(error);
        });
};
