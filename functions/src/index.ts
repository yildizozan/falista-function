/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions/v2";
import * as logger from "firebase-functions/logger";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {GoogleGenAI, createUserContent, createPartFromUri} from "@google/genai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();
const storage = getStorage();

// Initialize Gemini AI

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});

if (!GEMINI_API_KEY) {
  logger.error(
    "Gemini API key is not configured. Please set it using: " +
    "firebase functions:config:set gemini.api_key=\"YOUR_API_KEY\""
  );
}


// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// Function to process coffee collection documents with Gemini AI
export const processCoffeeWithGemini = onDocumentCreated(
  {
    document: "coffee/{docId}",
    region: "europe-west3",
    maxInstances: 10,
  },
  async (event) => {
    const data = event.data?.data();
    const docId = event.params?.docId;

    if (!data) {
      logger.error("No data associated with the event");
      return;
    }

    // Skip if result already exists to avoid infinite loops
    if (data.result) {
      logger.info(`Document ${docId} already has a result, skipping`);
      return;
    }

    // Store temp file paths for cleanup later
    const tempFiles: string[] = [];

    try {
      logger.info(`Processing coffee document: ${docId}`);

      // Set processing status
      await db.collection("coffee").doc(docId).update({
        status: "processing",
      });

      // Check if API key is available
      if (!GEMINI_API_KEY) {
        throw new Error("Gemini API key is not configured");
      }

      // Get user information from the document
      const userName = data?.userName || "kullanıcı";
      const userBirthday = data?.userBirthday || "belirtilmemiş";
      const userRelationStatus = data?.userRelationStatus ||
        "belirtilmemiş";
      const userEmploymentStatus = data?.userEmploymentStatus ||
        "belirtilmemiş";
      const photoPaths = data?.photoPaths || [];

      // Create the content for Gemini
      const contentParts = [];

      // Add photos if they exist
      if (photoPaths && photoPaths.length > 0) {
        for (const photoPath of photoPaths) {
          try {
            // Download file from Firebase Storage
            const bucket = storage.bucket();
            const file = bucket.file(photoPath);

            // Create a temporary file path
            const timestamp = Date.now();
            const baseName = path.basename(photoPath);
            const tempFileName = `temp_${timestamp}_${baseName}`;
            const tempFilePath = path.join(os.tmpdir(), tempFileName);

            // Download the file to temporary location
            await file.download({destination: tempFilePath});

            logger.info(
              `Downloaded file from Storage: ${photoPath} to ${tempFilePath}`
            );

            // Upload the file to Gemini
            const uploadedFile = await ai.files.upload({
              file: tempFilePath,
              config: {mimeType: "image/jpeg"},
            });

            // Add the uploaded file to content parts
            if (uploadedFile.uri && uploadedFile.mimeType) {
              contentParts.push(
                createPartFromUri(uploadedFile.uri, uploadedFile.mimeType)
              );
            }

            // Store temp file path for later cleanup
            tempFiles.push(tempFilePath);
          } catch (uploadError) {
            logger.warn(`Failed to process photo ${photoPath}:`, uploadError);
          }
        }
      }

      // Add the text prompt
      const chunks = [];

      // Prepare prompt chunks
      if (userName && userName !== "kullanıcı") {
        chunks.push(`ismim ${userName}`);
      }

      if (userBirthday && userBirthday !== "belirtilmemiş") {
        chunks.push(`dogum tarihim ${userBirthday}`);
      }

      if (userRelationStatus && userRelationStatus !== "belirtilmemiş") {
        chunks.push(`medeni durumum ${userRelationStatus}`);
      }

      if (userEmploymentStatus && userEmploymentStatus !== "belirtilmemiş") {
        chunks.push(`iş durumum ${userEmploymentStatus}`);
      }

      // Build the prompt from chunks
      const promptText = chunks.length > 0 ?
        chunks.join(", ") + ". Kahve falımı yorumla." :
        "Kahve falımı yorumla.";

      contentParts.push(promptText);

      // Generate content using Gemini
      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: createUserContent(contentParts),
      });

      const text = result.text;
      logger.info(`Gemini response received for document: ${docId}`);

      // Clean up temporary files after AI response
      for (const tempFile of tempFiles) {
        try {
          fs.unlinkSync(tempFile);
          logger.info(`Cleaned up temporary file: ${tempFile}`);
        } catch (cleanupError) {
          logger.warn(
            `Failed to clean up temp file ${tempFile}:`, cleanupError
          );
        }
      }

      // Update the document with the result
      await db.collection("coffee").doc(docId).update({
        result: {
          analysis: text,
          processedAt: new Date().toISOString(),
          source: "gemini-2.0-flash-001",
        },
        status: "completed",
      });

      logger.info(`Successfully updated document ${docId} with Gemini result`);
    } catch (error) {
      logger.error(`Error processing coffee document ${docId}:`, error);

      // Clean up temporary files in case of error too
      for (const tempFile of tempFiles) {
        try {
          fs.unlinkSync(tempFile);
          logger.info(`Cleaned up temporary file after error: ${tempFile}`);
        } catch (cleanupError) {
          logger.warn(
            `Failed to clean up temp file ${tempFile}:`, cleanupError
          );
        }
      }

      // Store error information in the document
      await db.collection("coffee").doc(docId).update({
        result: {
          error: "Failed to process with Gemini AI",
          errorDetails: error instanceof Error ? error.message : String(error),
          processedAt: new Date().toISOString(),
          source: "gemini-2.0-flash-001",
        },
        status: "error",
      });
    }
  }
);
