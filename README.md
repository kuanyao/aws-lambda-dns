## aws-lambda-dns
Use AWS Lambda to update Route 53 DNS records for tagged EC2 instances.

### Introduction
When EC2 instances start, they can be configured to assign a public IP address. In most time the iP addresses are dynmaically assigned unless the instance is iassocated with an Elastic IP. The IP address stays the same when instances are running. However, one may have reasons to stop and start instance periodically. For example, stop instances that no need to run during evening or weekend, test or demand, etc. When the instance is restarted, the address will be different. This gives some difficulties if someone needs to log into the host, or have to access the service hosted in that instance. They have go to AWS console to find the IP address, or use some API to get it.

It will be ideal that everytime when an EC2 instance's IP address changes, its public DNS entry is automatically updated in a Name Server. That one can keep using its dns name regardless the IP address change. This project is using AWS IAM, EC2, Lambda, Cloud Watch, SNS, and Route53 to achieve this automation.

### 2023 Update
1. Added support for multi-region Ec2 events: 
   - In each region, add a rule in the EventBridge to send Ec2 instance status notif (source) to the IAD's default event bus (target)
   - In IAD, change the event rule detail that include all message sending to the SNS (target)
   - Update the Lambda to read the region property from the event, and collect Ec2 instance in the according region.
1. Event Bridge is new service added after 2017, some new concept, but the overall flow remain the same
1. SNS doesn't seem to be needed here. I forgot why I used it, maybe because of easy for testing. However, EventBridge can invoke the Lambda directly. 
1. Todo: add cmd to automate this step

### 2026 Update
This repo now supports both the original same-account flow and a tested cross-account flow.

1. Keep the existing same-account flow unchanged:
   - EventBridge rule -> SNS topic -> `src/index.js`
   - `src/index.js` still supports the legacy raw EC2 state-change payload
2. Add a source-account enrichment Lambda:
   - `src/enricher.js`
   - Triggered by the source account EventBridge EC2 state-change rule
   - Reads the instance locally in that source account/region
   - Extracts the `domain` / `host` / `Name` tags and public IP
   - Publishes a normalized DNS update event to the central EventBridge bus
3. The central DNS Lambda now supports both:
   - legacy raw EC2 events from SNS
   - normalized `EC2 DNS Update Request` EventBridge events after they are forwarded through SNS

Recommended cross-account design:

- Source account:
  - EventBridge rule
  - Lambda using `src/enricher.js`
  - IAM:
    - `ec2:DescribeInstances`
    - `events:PutEvents` to the central EventBridge bus ARN
- Central/default account:
  - EventBridge rule matching:
    - `source = kuanyao.ec2dns`
    - `detail-type = EC2 DNS Update Request`
  - existing SNS topic
  - existing DNS updater Lambda using `src/index.js`
  - IAM:
    - Route 53 permissions only for the updater

Tested flow:

- Source account EventBridge EC2 state-change rule invokes `src/enricher.js`
- `src/enricher.js` calls `DescribeInstances` in the source account, then publishes a custom event to the central EventBridge bus
- Central EventBridge rule forwards that custom event to the existing SNS topic
- SNS invokes the existing DNS updater Lambda
- DNS updater Lambda updates Route 53 without any cross-account EC2 API call

Tested live on 2026-03-29:

- Source account: `867878846506` (`pkyao`)
- Source region: `us-east-2`
- Instance: `i-08ff1ed5c8a63c1fb`
- Tags:
  - `domain=dev.kuanyao.info`
  - `host=blacksheep`
- Central account: `456270554954`
- Result:
  - `blacksheep.dev.kuanyao.info -> 18.191.93.254`

### Components

- Central DNS updater Lambda:
  - `src/index.js`
  - deployed as `ec2_instance_route53_dns` in `us-east-1`
- Source-account enricher Lambda:
  - `src/enricher.js`
  - deployed as `ec2_instance_dns_enricher` in the source account/region
- Central EventBridge rule for enriched events:
  - `ec2-instance-dns-update-request`
- Existing SNS topic:
  - `ec2-instance-state-change`

### Design
- Use AWS Tags to associate instance meta data.
  - Instance is assigned a tag "domain", with value to be a DNS entry name, e.g. kuanyao.info
  - Instance is assigned a tag "host", the name will be used together with domain to form a valid dns entry, e.g. roboray.kuanyao.info
  - If no "host" tag found, then the "Name" tag is used.
- Use AWS Cloud Watch service to monitor EC2 instance state
  - Add a rule that whenever an EC2 instance changes state to "running" or "stoped", the service will send the event data to a SNS topic
- Use Lambda function to watch the instance state, and use its meta data to calcuate dns entry and and it in Route53.
  - Lambda function will subscribe the SNS topic
  - Lambda function get event data of EC2 intance state change, query for its tag "domain", and "host"
  - Lambda function updates DNS record for that instance in the Route53 service.

#### Other consideration
- Lambda function needs to assicated with IAM role that have access to EC2 instance and update Route53 record sets.
- A public domain needs to point its Name server to Route53 entry
  - Route53 can register domain and it will be easy to do things all together there.
  - Google Domain can easily be configured to point a domain or subdomain to Route53's name server.

### Resume Notes

For the latest live state and next steps, see [docs/status.md](docs/status.md).
