import { CfnOutput, Duration, Stack } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { sourceRoot } from "./config.js";

export class AwsLambdaDnsCentralStack extends Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    const centralConfig = props.centralConfig ?? {};
    const sourceDefaults = props.sourceDefaults ?? {};
    const eventBusName = centralConfig.eventBusName ?? "ec2-dns-central";
    const sourceStates = sourceDefaults.states ?? ["running", "stopped"];

    const eventBus = new events.EventBus(this, "CentralEventBus", {
      eventBusName
    });

    for (const accountId of centralConfig.allowedSourceAccounts ?? []) {
      new events.CfnEventBusPolicy(this, `CentralEventBusPolicy${accountId}`, {
        eventBusName,
        statementId: `AllowPutEventsFrom${accountId}`,
        statement: {
          Sid: `AllowPutEventsFrom${accountId}`,
          Effect: "Allow",
          Principal: {
            AWS: `arn:aws:iam::${accountId}:root`
          },
          Action: "events:PutEvents",
          Resource: eventBus.eventBusArn
        }
      });
    }

    const topic = new sns.Topic(this, "InstanceStateChangeTopic", {
      topicName: "ec2-instance-state-change"
    });

    const updaterFunction = new lambda.Function(this, "DnsUpdaterFunction", {
      functionName: "ec2_instance_route53_dns",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(sourceRoot),
      timeout: Duration.seconds(30)
    });

    updaterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "route53:ListHostedZonesByName",
          "route53:ListResourceRecordSets",
          "route53:ChangeResourceRecordSets"
        ],
        resources: ["*"]
      })
    );

    updaterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ec2:DescribeInstances"],
        resources: ["*"]
      })
    );

    topic.addSubscription(new subscriptions.LambdaSubscription(updaterFunction));

    new events.Rule(this, "SameAccountEc2StateChangeRule", {
      ruleName: "ec2-instance-status-change",
      description: "Forward EC2 same-account state changes to SNS for DNS updates.",
      eventPattern: {
        source: ["aws.ec2"],
        detailType: ["EC2 Instance State-change Notification"],
        detail: {
          state: sourceStates
        }
      },
      targets: [new eventsTargets.SnsTopic(topic)]
    });

    new events.Rule(this, "NormalizedUpdateRule", {
      ruleName: "ec2-instance-dns-update-request",
      description: "Forward normalized EC2 DNS update requests from the central bus to SNS.",
      eventBus,
      eventPattern: {
        source: ["kuanyao.ec2dns"],
        detailType: ["EC2 DNS Update Request"]
      },
      targets: [new eventsTargets.SnsTopic(topic)]
    });

    new CfnOutput(this, "CentralAccountId", {
      value: this.account
    });

    new CfnOutput(this, "CentralRegion", {
      value: this.region
    });

    new CfnOutput(this, "CentralEventBusArn", {
      value: eventBus.eventBusArn
    });

    new CfnOutput(this, "SnsTopicArn", {
      value: topic.topicArn
    });

    new CfnOutput(this, "DnsUpdaterFunctionName", {
      value: updaterFunction.functionName
    });
  }
}
