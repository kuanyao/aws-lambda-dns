# aws-lambda-dns status

Last updated: 2026-05-09

## Current architecture

- Same-account path remains in place:
  - EventBridge EC2 state change
  - SNS topic
  - central Route 53 updater Lambda
- Cross-account path now works:
  - source-region EventBridge rule
  - source-region enricher Lambda
  - central custom EventBridge bus
  - central EventBridge rule
  - existing SNS topic
  - existing Route 53 updater Lambda

## Live resources

Central/default account: `867878846506`

- Event bus:
  - `arn:aws:events:us-east-1:867878846506:event-bus/ec2-dns-central`
- SNS topic:
  - `arn:aws:sns:us-east-1:867878846506:ec2-instance-state-change`
- Central EventBridge rule for enriched events:
  - `ec2-instance-dns-update-request`
- Central Lambda:
  - name: `ec2_instance_route53_dns`
  - region: `us-east-1`
  - deployed by `AwsLambdaDnsCentralStack`

Source account/region now managed by CDK:

- account: `867878846506`
- region: `us-east-2`
- Source EventBridge rule:
  - `ec2-instance-status-change`
- Source Lambda:
  - name: `ec2_instance_dns_enricher`
  - role: `lambda-ec2-dns-enricher-us-east-2`
  - deployed by `AwsLambdaDnsSourceStack`

## Tested instance

- account: `867878846506`
- region: `us-east-2`
- instance id: `i-04ff2a11bc1fef962`
- tags:
  - `domain=utility.kuanyao.info`
  - `host=p-video`
  - `Name=p-video`

## Verified result

On 2026-05-09 the CDK-managed `us-east-2` source stack successfully published an enriched event that the central path processed.

Confirmed outputs:

- Route 53 record:
  - `p-video.utility.kuanyao.info A 3.134.108.31`

## Code changes in this repo

- [src/index.js](/Users/kuanyao/github/aws-lambda-dns/src/index.js)
  - accepts both legacy SNS-wrapped raw EC2 events and enriched SNS-wrapped EventBridge events
- [src/enricher.js](/Users/kuanyao/github/aws-lambda-dns/src/enricher.js)
  - source-region enrichment Lambda
- [config/topology.json](/Users/kuanyao/github/aws-lambda-dns/config/topology.json)
  - tracked central/source rollout topology
- [infra/cdk](/Users/kuanyao/github/aws-lambda-dns/infra/cdk/package.json)
  - central and source CDK stacks
- [README.md](/Users/kuanyao/github/aws-lambda-dns/README.md)
  - documents the managed dual-path architecture and onboarding steps

## IAM notes

- Source Lambda needs:
  - `ec2:DescribeInstances`
  - `events:PutEvents` to the central custom bus
- Central Lambda no longer needs cross-account EC2 access for the new path
- Source IAM roles are account-global IAM resources, so source stacks now use region-scoped role names
  - example: `lambda-ec2-dns-enricher-us-east-2`

## Resume point

The central stack and the `us-east-2` source stack are both CDK-managed and working.

Likely next improvements:

- remove SNS from the architecture if you want fewer hops
- onboard more regions in the same account
- onboard additional source accounts by updating `config/topology.json`
- add beta/prod CI/CD around the central and source stacks

## 2026-05-09 planning update

- Central bus permissions come from `config/topology.json`
- Source stack naming defaults also come from `config/topology.json`
- Additional accounts can be allowlisted centrally before deploying new regional source stacks
- Future CI/CD direction:
  - GitHub private repo via CodeConnections
  - CodePipeline + CodeBuild
  - beta stacks before prod
  - manual approval between beta and prod
