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

### Current Architecture

This repo supports both:

1. Same-account flow:
   - default EventBridge EC2 state-change rule
   - SNS topic
   - central DNS updater Lambda `src/index.js`
2. Cross-account / cross-region flow:
   - source-region EventBridge rule
   - source-region enricher Lambda `src/enricher.js`
   - central custom EventBridge bus
   - central EventBridge rule
   - SNS topic
   - central DNS updater Lambda `src/index.js`

The current recommended design is:

- Central account/region:
  - one custom EventBridge bus in `us-east-1`
  - one SNS topic
  - one Route 53 updater Lambda
  - one EventBridge rule that forwards normalized DNS update events from the custom bus to SNS
- Source account/region:
  - one EventBridge rule per region on the default bus
  - one enricher Lambda per region
  - the enricher reads EC2 tags locally and publishes a normalized event to the central bus

The central Lambda does not need cross-account EC2 permissions in this design.

### IaC

This repo now includes a CDK workspace for both the central stack and regional source stacks.

- Central stack:
  - `AwsLambdaDnsCentralStack`
  - resources:
    - EventBridge bus `ec2-dns-central`
    - SNS topic `ec2-instance-state-change`
    - updater Lambda `ec2_instance_route53_dns`
    - same-account default-bus EC2 rule -> SNS
    - central custom-bus normalized rule -> SNS
    - EventBridge bus policies for allowlisted source accounts
- Source stack:
  - `AwsLambdaDnsSourceStack`
  - resources:
    - enricher Lambda `ec2_instance_dns_enricher`
    - default-bus EC2 state-change rule
    - region-scoped IAM role such as `lambda-ec2-dns-enricher-us-east-2`

Tracked topology config lives in:

- [config/topology.json](config/topology.json)

It defines:

- central account id
- central region
- central bus name
- allowlisted source accounts that may `events:PutEvents`
- default source Lambda / IAM role prefix / rule naming

### Current Live State

Current central account:

- `867878846506`

Current central resources:

- EventBridge bus:
  - `arn:aws:events:us-east-1:867878846506:event-bus/ec2-dns-central`
- SNS topic:
  - `arn:aws:sns:us-east-1:867878846506:ec2-instance-state-change`
- updater Lambda:
  - `ec2_instance_route53_dns`

Current CDK-managed source region:

- account: `867878846506`
- region: `us-east-2`
- enricher Lambda:
  - `ec2_instance_dns_enricher`
- IAM role:
  - `lambda-ec2-dns-enricher-us-east-2`
- EventBridge rule:
  - `ec2-instance-status-change`

### Deploy

Install dependencies:

```bash
npm install
```

Deploy the central stack from the repo root:

```bash
npm run cdk:deploy:central
```

This uses the current default AWS profile/account. The central target is also recorded in `config/topology.json`.

Deploy a source stack in a region:

```bash
SOURCE_STACK_REGION=us-east-2 npm run cdk:deploy:source
```

The source deploy derives the central bus ARN from `config/topology.json`, so you do not need to pass it manually.

### Regional Onboarding

To onboard another source region in the same account:

1. Make sure the target region is CDK-bootstrapped.
   Example:

   ```bash
   npx cdk bootstrap aws://867878846506/us-west-2
   ```

2. Deploy the source stack in that region.

   ```bash
   SOURCE_STACK_REGION=us-west-2 npm run cdk:deploy:source
   ```

3. Verify:
   - Lambda `ec2_instance_dns_enricher` exists in that region
   - EventBridge rule `ec2-instance-status-change` targets that Lambda
   - IAM role name is region-scoped, for example `lambda-ec2-dns-enricher-us-west-2`

4. Test with a tagged EC2 instance:
   - required tags:
     - `domain`
     - `host` or `Name`

To onboard another source account:

1. Add that account id to `central.allowedSourceAccounts` in `config/topology.json`
2. Deploy the central stack so the EventBridge bus policy is updated
3. In the source account, bootstrap the target region
4. Deploy the source stack in each desired region in that source account

### Testing

Fast verification:

- `npm run cdk:synth:central`
- `SOURCE_STACK_REGION=us-east-2 npm run cdk:synth:source`

Functional verification:

- invoke the enricher Lambda with a synthetic EC2 state-change event
- verify the central updater logs
- verify the Route 53 record

Current tested live example:

- source region: `us-east-2`
- instance:
  - `i-04ff2a11bc1fef962`
- tags:
  - `domain=utility.kuanyao.info`
  - `host=p-video`
- verified Route 53 result:
  - `p-video.utility.kuanyao.info A 3.134.108.31`

### Future CI/CD

Full CI/CD is not set up yet, but the repo is now structured for it.

Recommended direction:

- Source:
  - GitHub private repo through CodeConnections
- Build:
  - CodeBuild runs:
    - `npm install`
    - `npm run cdk:synth:central`
    - `SOURCE_STACK_REGION=<region> npm run cdk:synth:source`
    - tests / diffs
- Deploy:
  - CodePipeline stages for:
    - beta central stack
    - beta source stack(s)
    - integration test step
    - manual approval
    - production central stack
    - production source stack(s)

For this repo, CodePipeline + CodeBuild is a better fit than CodeDeploy because the primary artifact is CDK / CloudFormation infrastructure.

### Multi-Region And Cross-Account Strategy

- Keep one central stack in `us-east-1`
- Use one source stack per region
- Use region-scoped IAM role names for source Lambdas
- Keep source account permissions explicit in `config/topology.json`
- Update the central bus policy first before onboarding a new source account
- Reuse the same normalized event contract across all source regions/accounts

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
