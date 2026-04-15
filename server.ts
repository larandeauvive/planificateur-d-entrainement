import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes
  app.post("/api/generate-nutrition", async (req, res) => {
    try {
      const { type, description } = req.body;
      
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `
En tant que coach sportif et nutritionniste expert, donne-moi des conseils précis pour une séance de sport.
Type de séance : ${type || 'Non spécifié'}
Description : ${description || 'Non spécifiée'}

Réponds UNIQUEMENT avec un objet JSON valide ayant exactement ces 3 clés (et rien d'autre) :
{
  "sessionNutrition": "Conseil très court (max 15 mots) sur ce qu'il faut prendre PENDANT ou JUSTE AVANT/APRÈS la séance (ex: 1 gel toutes les 45min, boisson iso).",
  "dailyNutrition": "Conseil très court (max 15 mots) sur l'alimentation de la journée en dehors de l'entraînement pour maximiser l'effort et la récupération (ex: Charge glucidique à midi, repas léger le soir).",
  "dailyHydration": "Conseil très court (max 15 mots) sur l'hydratation de la journée (ex: 1L St Yorre pour les minéraux + 1.5L eau claire)."
}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("No response from Gemini");
      }

      const data = JSON.parse(text);
      res.json(data);
    } catch (error) {
      console.error("Error generating nutrition advice:", error);
      res.status(500).json({ error: "Failed to generate nutrition advice" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
