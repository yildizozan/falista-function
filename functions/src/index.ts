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
import {GoogleGenAI, createUserContent, createPartFromUri} from "@google/genai";

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

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
      const photoUrls = data?.photoUrls || [];

      // Create the content for Gemini
      const contentParts = [];

      // Add photos if they exist
      if (photoUrls && photoUrls.length > 0) {
        for (const photoUrl of photoUrls) {
          try {
            // Upload the file to Gemini
            const uploadedFile = await ai.files.upload({
              file: photoUrl, // Assuming this is a URL or file path
              config: {mimeType: "image/jpeg"},
            });

            // Add the uploaded file to content parts
            if (uploadedFile.uri && uploadedFile.mimeType) {
              contentParts.push(
                createPartFromUri(uploadedFile.uri, uploadedFile.mimeType)
              );
            }
          } catch (uploadError) {
            logger.warn(`Failed to upload photo ${photoUrl}:`, uploadError);
          }
        }
      }

      // Add the text prompt
      const prompt = `ismim ${userName}, dogum tarihim ${userBirthday}, ` +
        `medeni durumum ${userRelationStatus}, is durumum ` +
        `${userEmploymentStatus}. Kahve falimi yorumla.`;
      contentParts.push(prompt);

      // Generate content using Gemini
      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: createUserContent(contentParts),
      });

      const text = result.text;
      logger.info(`Gemini response received for document: ${docId}`);

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
