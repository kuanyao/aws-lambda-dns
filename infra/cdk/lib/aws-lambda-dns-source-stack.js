import { CfnOutput, Duration, Stack } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { sourceRoot } from "./config.js";

export class AwsLambdaDnsSourceStack extends Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    if (!props.centralEventBusArn) {
      throw new Error("Missing centralEventBusArn for AwsLambdaDnsSourceStack.");
    }

    const sourceDefaults = props.sourceDefaults ?? {};
    const functionName = sourceDefaults.functionName ?? "ec2_instance_dns_enricher";
    const roleNamePrefix = sourceDefaults.roleNamePrefix ?? "lambda-ec2-dns-enricher";
    const ruleName = sourceDefaults.ruleName ?? "ec2-instance-status-change";
    const sourceStates = sourceDefaults.states ?? ["running", "stopped"];
    const roleName = `${roleNamePrefix}-${this.region}`;

    const enricherRole = new iam.Role(this, "DnsEnricherRole", {
      roleName,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
      ]
    });

    enricherRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ec2:DescribeInstances"],
        resources: ["*"]
      })
    );

    enricherRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [props.centralEventBusArn]
      })
    );

    const enricherFunction = new lambda.Function(this, "DnsEnricherFunction", {
      functionName,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "enricher.handler",
      code: lambda.Code.fromAsset(sourceRoot),
      timeout: Duration.seconds(30),
      role: enricherRole,
      environment: {
        CENTRAL_EVENT_BUS_ARN: props.centralEventBusArn
      }
    });

    new events.Rule(this, "SourceEc2StateChangeRule", {
      ruleName,
      description: "Invoke the enricher Lambda on EC2 running/stopped state changes.",
      eventPattern: {
        source: ["aws.ec2"],
        detailType: ["EC2 Instance State-change Notification"],
        detail: {
          state: sourceStates
        }
      },
      targets: [new eventsTargets.LambdaFunction(enricherFunction)]
    });

    new CfnOutput(this, "SourceRegion", {
      value: this.region
    });

    new CfnOutput(this, "DnsEnricherFunctionName", {
      value: enricherFunction.functionName
    });

    new CfnOutput(this, "TargetCentralEventBusArn", {
      value: props.centralEventBusArn
    });
  }
}
