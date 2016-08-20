'use strict';

console.log('Loading function');

var AWS = require('aws-sdk');
var ec2 = new AWS.EC2({ "region": "us-east-1"});
var route53 = new AWS.Route53();

function updateDnsRecord(name, domain, ipAddress) {
    var dnsEntry = name + '.' + domain;
    console.log('request to update dns record for ', dnsEntry);
    //get hosted zone id
    return route53.listHostedZonesByName({'DNSName': domain})
        .promise()
        .then(function(data){
            var hostedZone = data.HostedZones.find(hz => hz.Name == domain + '.');
            if (hostedZone) {
                return hostedZone.Id;
            }
        })
        .then(function(hostedZoneId){
            if (!hostedZoneId) {
                console.log('no hostedZoneId found for ' + domain);
                return;
            }

            var params = {
              ChangeBatch: { 
                Changes: [],
              },
              HostedZoneId: hostedZoneId
            };
            var change = {};
            if (!ipAddress) {
                params.ChangeBatch.Comment = 'request to delete for dns record ' + dnsEntry;
                console.log(params.ChangeBatch.Comment);

                change.Action = 'DELETE';

                //get record set first
                return route53.listResourceRecordSets({HostedZoneId: hostedZoneId})
                        .promise()
                        .then(function(data){
                            var recordSet = data.ResourceRecordSets.find(rs => rs.Name == dnsEntry + '.');
                            if (recordSet) {
                                change.ResourceRecordSet = recordSet;
                                params.ChangeBatch.Changes.push(change);
                                return route53.changeResourceRecordSets(params).promise();
                            }
                        });
            } else {
                params.ChangeBatch.Comment = 'request to create/update dns record ' + dnsEntry + ' with ip address ' + ipAddress;
                console.log(params.ChangeBatch.Comment);

                change.Action = 'UPSERT';
                change.ResourceRecordSet = { 
                      Name: dnsEntry,
                      Type: 'A', 
                      ResourceRecords: [{Value: ipAddress}],
                      TTL: 300,
                    };

                params.ChangeBatch.Changes.push(change);
                return route53.changeResourceRecordSets(params).promise();
            }
        })
        .then(function(data){
            if (data) {
                console.log("succssfully updated dns record for instance " + dnsEntry);
            }
        });
}

exports.handler = (event, context, callback) => {
    //console.log('Received event:', JSON.stringify(event, null, 2))
    const message = event.Records[0].Sns.Message;
    console.log('From SNS:', message);
    
    var detail = JSON.parse(message);
    var instanceId = detail['instance-Id'],
        state = detail.state; 

    var params = { InstanceIds: [instanceId]};

    ec2.describeInstances(params)
        .promise()
        .then(function(data){
            if (data.Reservations.length === 0) {
                console.log('no instance found with instanceId ' + instanceId);
                return;
            }
            var instance = data.Reservations[0].Instances[0],
                tags = instance.Tags;
            var name, domain, publicIp;

            var domainTag = tags.find(t => t.Key == 'domain');
            if (!domainTag) return;
            domain = domainTag.Value;
            if (!domain) return;

            var hostTag = tags.find(t => t.Key == 'host');
            if (hostTag) name = hostTag.Value;

            if (!name) {
                var nameTag = tags.find(t => t.Key == 'Name');
                if (nameTag) name = nameTag.Value;
            }
            if (!name) return;

            publicIp = instance.PublicIpAddress;
            return updateDnsRecord(name, domain, publicIp);
        })
        .catch(function(error){
            console.log(error);
        });
};