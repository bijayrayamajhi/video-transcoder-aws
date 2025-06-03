import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import fsOld from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const RESOLUTIONS = [
  { name: "360p", width: 480, height: 360 },
  { name: "480p", width: 858, height: 480 },
  { name: "720p", width: 1280, height: 720 },
];

async function init() {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: process.env.VIDEO_KEY,
    });

    const response = await s3Client.send(command);
    const originalFilePath = `original-video.mp4`;
    const bodyBuffer = await streamToBuffer(response.Body);
    await fs.writeFile(originalFilePath, bodyBuffer);
    const originalVideoPath = path.resolve(originalFilePath);

    //start the transcoder for each video
    const promises = RESOLUTIONS.map((resolution) => {
      const output = `video-${resolution.name}.mp4`;

      return new Promise((resolve, reject) => {
        ffmpeg(originalVideoPath)
          .output(output)
          .withVideoCodec("libx264")
          .withAudioCodec("aac")
          .withSize(`${resolution.width}x${resolution.height}`)
          .on("end", async () => {
            //upload the video into another s3
            const putCommand = new PutObjectCommand({
              Bucket: process.env.TRANSCODED_BUCKET_NAME,
              Key: output,
              Body: fsOld.createReadStream(path.resolve(output)),
            });
            await s3Client.send(putCommand);
            console.log(`uploaded ${output}`);
            resolve();
          })
          .on("error", (ffmpegError) => {
            console.error(`Transcoding failed for ${output}:`, ffmpegError);
            reject(ffmpegError);
          })
          .format("mp4")
          .run();
      });
    });

    //Waits until all transcoding + uploading Promises resolve.
    await Promise.all(promises);
  } catch (error) {
    console.error("Error during initialization:", error);
    process.exit(1);
  }
}

init().finally(() => process.exit(0));
