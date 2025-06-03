import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import type { S3Event } from "aws-lambda";
import dotenv from "dotenv";
import { ecsClient } from "./utils/ecs-client";
import { sqsClient } from "./utils/sqs-client";
import { RunTaskCommand } from "@aws-sdk/client-ecs";

dotenv.config();

async function init() {
  try {
    const command = new ReceiveMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
    });
    while (true) {
      const { Messages } = await sqsClient.send(command);
      if (!Messages || Messages.length === 0) {
        console.log("No messages received");
        continue;
      }
      for (const message of Messages) {
        const { MessageId, Body } = message;
        console.log(`Received message with ID: ${MessageId}`);
        console.log(`Message body: ${Body}`);

        //validate and parse the event

        if (!Body) {
          console.error("Message body is empty");
          continue;
        }
        const event = JSON.parse(Body) as S3Event;

        //ignore and delete test events
        if ("Service" in event && "Event" in event) {
          if (event.Event === "s3:TestEvent") {
            await sqsClient.send(
              new DeleteMessageCommand({
                QueueUrl: process.env.SQS_QUEUE_URL,
                ReceiptHandle: message.ReceiptHandle,
              })
            );
            continue;
          }
        }

        //spin the docker container for each record
        for (const record of event.Records) {
          const { s3 } = record;
          const {
            bucket,
            object: { key },
          } = s3;

          const runTaskCommand = new RunTaskCommand({
            taskDefinition: process.env.ECS_TASK_DEFINITION,
            cluster: process.env.ECS_CLUSTER_NAME,
            launchType: "FARGATE",
            networkConfiguration: {
              awsvpcConfiguration: {
                securityGroups: ["sg-0c832a20bc987bfa6"],
                subnets: [
                  "subnet-0f8594e5c6451c123",
                  "subnet-00da7c513a74f518c",
                  "subnet-0d263c522371bbeff",
                ],

                assignPublicIp: "ENABLED",
              },
            },
            overrides: {
              containerOverrides: [
                {
                  name: process.env.CONTAINER_NAME,
                  environment: [
                    { name: "BUCKET_NAME", value: bucket.name },
                    { name: "VIDEO_KEY", value: key },
                    {
                      name: "TRANSCODED_BUCKET_NAME",
                      value: process.env.TRANSCODED_BUCKET_NAME,
                    },
                    { name: "AWS_REGION", value: process.env.AWS_REGION },
                    { name: "AWS_ACCESS_KEY_ID", value: process.env.AWS_ACCESS_KEY_ID },
                    {
                      name: "AWS_SECRET_ACCESS_KEY",
                      value: process.env.AWS_SECRET_ACCESS_KEY,
                    },
                  ],
                },
              ],
            },
          });
          await ecsClient.send(runTaskCommand);

          //delete the message from the queue

          await sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: process.env.SQS_QUEUE_URL,
              ReceiptHandle: message.ReceiptHandle,
            })
          );
        }
      }
    }
  } catch (error) {
    console.error("Error initializing SQS client:", error);
    process.exit(1);
  }
}

init();
