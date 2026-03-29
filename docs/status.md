# aws-lambda-dns status

Last updated: 2026-03-29

## Current architecture

- Same-account path remains in place:
  - EventBridge EC2 state change
  - SNS topic
  - central Route 53 updater Lambda
- Cross-account path now works:
  - source-account EventBridge rule
  - source-account enricher Lambda
  - central default EventBridge bus
  - central EventBridge rule
  - existing SNS topic
  - existing Route 53 updater Lambda

## Live resources

Central/default account: `456270554954`

- Event bus:
  - `arn:aws:events:us-east-1:456270554954:event-bus/default`
- SNS topic:
  - `arn:aws:sns:us-east-1:456270554954:ec2-instance-state-change`
- Central EventBridge rule for enriched events:
  - `ec2-instance-dns-update-request`
- Central Lambda:
  - name: `ec2_instance_route53_dns`
  - region: `us-east-1`
  - role: `lambda-ec2-dns`

Source account: `867878846506` (`pkyao`)

- Source EventBridge rule:
  - `ec2-instance-status-change`
- Source Lambda:
  - name: `ec2_instance_dns_enricher`
  - region: `us-east-2`
  - role: `lambda-ec2-dns-enricher`

## Tested instance

- account: `867878846506`
- region: `us-east-2`
- instance id: `i-08ff1ed5c8a63c1fb`
- tags:
  - `domain=dev.kuanyao.info`
  - `host=blacksheep`
  - `Name=dev`

## Verified result

On 2026-03-29 the source Lambda published an enriched event that the central path processed successfully.

Confirmed outputs:

- central Lambda log:
  - `successfully updated dns record for blacksheep.dev.kuanyao.info`
- Route 53 record:
  - `blacksheep.dev.kuanyao.info A 18.191.93.254`

## Code changes in this repo

- [src/index.js](/Users/kuanyao/github/aws-lambda-dns/src/index.js)
  - accepts both legacy SNS-wrapped raw EC2 events and enriched SNS-wrapped EventBridge events
- [src/enricher.js](/Users/kuanyao/github/aws-lambda-dns/src/enricher.js)
  - new source-account enrichment Lambda
- [README.md](/Users/kuanyao/github/aws-lambda-dns/README.md)
  - documents the new dual-path architecture

## IAM notes

- Source Lambda needs:
  - `ec2:DescribeInstances`
  - `events:PutEvents` to the central default bus
- Central Lambda no longer needs cross-account EC2 access for the new path
- `AWSLambdaBasicExecutionRole` was attached to `lambda-ec2-dns` so logs now appear in CloudWatch

## Resume point

The cross-account `pkyao` -> central EventBridge -> SNS -> Route 53 path is working.

Likely next improvements:

- remove SNS from the architecture if you want fewer hops
- migrate other accounts/regions to the same enrichment contract
- add IaC/deploy scripts so the new enricher Lambda and rules are reproducible
