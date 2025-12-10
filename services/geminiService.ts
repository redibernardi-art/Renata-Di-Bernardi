import { GoogleGenAI } from "@google/genai";

// Fallback API key provided by user
const FALLBACK_API_KEY = 'AIzaSyAjQmY4qoW5yYNGfM-S9syM2SHnuh63yZM';

export const generateImageFromPrompt = async (
  prompt: string, 
  aspectRatio: string = "16:9", 
  resolution: string = "2K",
  model: string = "gemini-3-pro-image-preview"
): Promise<string> => {
  const apiKey = process.env.API_KEY || FALLBACK_API_KEY;

  if (!apiKey) {
    throw new Error("API Key is missing. Please connect your account.");
  }

  // Create a new instance every time to ensure the latest key is used
  const ai = new GoogleGenAI({ apiKey });

  const extractImage = (response: any) => {
    if (!response || !response.candidates || response.candidates.length === 0) {
      throw new Error("No image candidates returned from the API.");
    }

    const candidate = response.candidates[0];
    
    // Iterate parts to find the image
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
           const mimeType = part.inlineData.mimeType || 'image/png';
           return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("The model generated a response but no image data was found.");
  };

  // If user explicitly selects Flash, use it directly without fallback logic
  if (model === 'gemini-2.5-flash-image') {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio,
            // imageSize is NOT supported on flash-image
          }
        }
      });
      return extractImage(response);
    } catch (error) {
      console.error("Gemini Flash Image Gen Error:", error);
      throw error;
    }
  }

  // Default behavior: Try Pro model first, fallback to Flash if needed
  try {
    // Attempt 1: Try the Pro model for high quality
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: resolution 
        }
      }
    });
    return extractImage(response);

  } catch (error: any) {
    const msg = error.toString();
    // Check for Permission Denied (403) or Not Found (404) to trigger fallback
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("404") || msg.includes("NOT_FOUND")) {
      console.warn("Primary model failed (Permission/Not Found), falling back to gemini-2.5-flash-image");
      
      try {
        const fallbackResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [{ text: prompt }],
          },
          config: {
            imageConfig: {
              aspectRatio: aspectRatio,
              // imageSize is NOT supported on flash-image
            }
          }
        });
        return extractImage(fallbackResponse);
      } catch (fallbackError: any) {
        console.error("Fallback generation failed:", fallbackError);
        // Throw the fallback error if it fails too
        throw fallbackError;
      }
    }
    
    // Re-throw if it's another type of error
    console.error("Gemini Image Gen Error:", error);
    throw error;
  }
};

export const generateVideoFromImage = async (
  prompt: string,
  imageBase64: string,
  aspectRatio: string = "16:9"
): Promise<string> => {
  const apiKey = process.env.API_KEY || FALLBACK_API_KEY;
  if (!apiKey) throw new Error("API Key missing");

  const ai = new GoogleGenAI({ apiKey });

  // Clean base64 string to get raw bytes
  const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
  const mimeType = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,/)?.[1] || 'image/png';

  // Strict aspect ratio mapping for Veo
  const veoAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';

  // Common config for Veo requests
  const videoConfig = {
    numberOfVideos: 1,
    resolution: '720p',
    aspectRatio: veoAspectRatio
  };

  const imagePart = {
    imageBytes: cleanBase64,
    mimeType: mimeType,
  };

  let operation;

  // Attempt 1: Fast model
  try {
    operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      image: imagePart,
      config: videoConfig
    });
  } catch (error: any) {
    // If 404 Not Found, try the standard model
    const msg = error.toString();
    if (msg.includes("404") || msg.includes("NOT_FOUND")) {
      console.warn("Veo Fast model not found, falling back to standard Veo model.");
      operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: prompt,
        image: imagePart,
        config: videoConfig
      });
    } else {
      throw error;
    }
  }

  // Poll for completion
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds (recommended for Veo)
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  if (operation.error) {
    throw new Error(`Video generation failed: ${operation.error.message}`);
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    throw new Error("No video URI returned from the API.");
  }

  // Fetch the video bytes using the URI + API Key
  const videoResponse = await fetch(`${videoUri}&key=${apiKey}`);
  if (!videoResponse.ok) throw new Error("Failed to download generated video.");

  const blob = await videoResponse.blob();
  
  // Convert blob to Base64 Data URI for storage/display consistency
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};