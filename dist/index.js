"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_sqs_1 = require("@aws-sdk/client-sqs");
const dotenv_1 = __importDefault(require("dotenv"));
const ecs_client_1 = require("./utils/ecs-client");
const sqs_client_1 = require("./utils/sqs-client");
const client_ecs_1 = require("@aws-sdk/client-ecs");
dotenv_1.default.config();
function init() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const command = new client_sqs_1.ReceiveMessageCommand({
                QueueUrl: process.env.SQS_QUEUE_URL,
                MaxNumberOfMessages: 1,
                WaitTimeSeconds: 20,
            });
            while (true) {
                const { Messages } = yield sqs_client_1.sqsClient.send(command);
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
                    const event = JSON.parse(Body);
                    //ignore and delete test events
                    if ("Service" in event && "Event" in event) {
                        if (event.Event === "s3:TestEvent") {
                            yield sqs_client_1.sqsClient.send(new client_sqs_1.DeleteMessageCommand({
                                QueueUrl: process.env.SQS_QUEUE_URL,
                                ReceiptHandle: message.ReceiptHandle,
                            }));
                            continue;
                        }
                    }
                    //spin the docker container for each record
                    for (const record of event.Records) {
                        const { s3 } = record;
                        const { bucket, object: { key }, } = s3;
                        const runTaskCommand = new client_ecs_1.RunTaskCommand({
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
                                        ],
                                    },
                                ],
                            },
                        });
                        yield ecs_client_1.ecsClient.send(runTaskCommand);
                        //delete the message from the queue
                        yield sqs_client_1.sqsClient.send(new client_sqs_1.DeleteMessageCommand({
                            QueueUrl: process.env.SQS_QUEUE_URL,
                            ReceiptHandle: message.ReceiptHandle,
                        }));
                    }
                }
            }
        }
        catch (error) {
            console.error("Error initializing SQS client:", error);
            process.exit(1);
        }
    });
}
init();
