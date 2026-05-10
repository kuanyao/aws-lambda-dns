#!/usr/bin/env node
import "source-map-support/register.js";

import * as cdk from "aws-cdk-lib";

import { AwsLambdaDnsCentralStack } from "../lib/aws-lambda-dns-central-stack.js";
import { loadTopology } from "../lib/config.js";
import { AwsLambdaDnsSourceStack } from "../lib/aws-lambda-dns-source-stack.js";

const app = new cdk.App();
const topology = loadTopology();
const centralEventBusArn = process.env.DNS_ENRICHER_CENTRAL_EVENT_BUS_ARN
  ?? `arn:aws:events:${topology.central.region}:${topology.central.accountId}:event-bus/${topology.central.eventBusName}`;

new AwsLambdaDnsCentralStack(app, "AwsLambdaDnsCentralStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? topology.central.region
  },
  centralConfig: topology.central,
  sourceDefaults: topology.sourceDefaults
});

if (process.env.DEPLOY_SOURCE_STACK === "true" || process.env.DNS_ENRICHER_CENTRAL_EVENT_BUS_ARN) {
  new AwsLambdaDnsSourceStack(app, "AwsLambdaDnsSourceStack", {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.SOURCE_STACK_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1"
    },
    centralEventBusArn,
    sourceDefaults: topology.sourceDefaults
  });
}
