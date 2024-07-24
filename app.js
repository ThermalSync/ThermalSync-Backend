const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = 3000;

// gemini configurations
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const chatModel = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

const instructionsModel = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

app.use(cors());
app.use(express.json());

// Store conversation history for each session
const sessions = {};

// Endpoint to create a new session and return the session ID
app.get("/create_session", (req, res) => {
  const sessionId = uuidv4();
  sessions[sessionId] = [];
  res.json({ sessionId });
});

// chatbot
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  if (!message) {
    return res.status(400).send("No message provided");
  }

  let currentSessionId = sessionId || uuidv4();

  // Initialize session if it doesn't exist or if the provided sessionId is invalid
  if (!sessions[currentSessionId] || !sessions[currentSessionId].chatSession) {
    sessions[currentSessionId] = {
      history: [],
      chatSession: chatModel.startChat({
        generationConfig,
        history: [],
      }),
    };
  }

  try {
    // Send message using the existing chat session
    const result = await sessions[currentSessionId].chatSession.sendMessage(
      message
    );

    // Append the user message and assistant's response to the session's conversation history
    sessions[currentSessionId].history.push(
      { role: "user", parts: [{ text: message }] },
      { role: "assistant", parts: [{ text: result.response.text() }] }
    );

    res.json({
      sessionId: currentSessionId,
      response: result.response.text(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred");
  }
});

// weather prediction
app.post("/predicted", async (req, res) => {
  const { lat, lon } = req.body;

  if (!lat || !lon) {
    return res
      .status(400)
      .send({ error: "Latitude and longitude are required" });
  }

  try {
    // Fetch weather data from OpenWeatherMap API
    const weatherResponse = await axios.get(
      `https://api.weatherapi.com/v1/forecast.json?q=${lat},${lon}&days=11&alerts=no&aqi=no&tp=24&key=${process.env.API_KEY}`
    );
    const weatherData = weatherResponse.data;
    const forecastDays = weatherData.forecast.forecastday;

    function calculateOutputReduction(avgTmp) {
      let reduction = 0;
      if (avgTmp > 25) {
        reduction = (avgTmp - 25) * 0.5;
      }
      return 100 - reduction;
    }

    const outputReductions = forecastDays.map((day) =>
      calculateOutputReduction(day.day.avgtemp_c)
    );

    const location = {
      region: weatherData.location.region,
      country: weatherData.location.country,
    };

    const currentWeather = {
      date: forecastDays[0].date,
      temp: weatherData.current.temp_c,
      condition: weatherData.current.condition.text,
      windSpeed: weatherData.current.wind_kph,
      humidity: weatherData.current.humidity,
      feelsLike: weatherData.current.feelslike_c,
      minTemp: forecastDays[0].day.mintemp_c,
      maxTemp: forecastDays[0].day.maxtemp_c,
    };

    const forecast = forecastDays.map((day) => ({
      date: day.date,
      temp: day.day.avgtemp_c,
      condition: day.day.condition.text,
      windSpeed: day.day.maxwind_kph,
      humidity: day.day.avghumidity,
      minTemp: day.day.mintemp_c,
      maxTemp: day.day.maxtemp_c,
    }));

    res.json({
      location,
      current: currentWeather,
      forecast,
      output: outputReductions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "An error occurred" });
  }
});

// generate instructions
app.post("/generate_instructions", async (req, res) => {
  const weatherData = req.body;

  if (!weatherData) {
    return res.status(400).send("No weather data provided");
  }

  const structuredPrompt = `
  You are to generate detailed instructions for managing solar panels based on the provided weather data (temperature in Celsius, and wind speed in Kph). Your response should be in JSON object format (not JSON string). Ensure to include an alert indicating if the weather conditions will affect the solar panels and provide a comprehensive list of instructions to prevent damage and optimize output. Include specific measures for various weather conditions, such as high temperatures, low temperatures, high winds, and other relevant factors. The response must be in the following JSON structure with the same keys and data types as shown below:
  
  {
    "alert": {
      "isActive": Boolean, // true if the weather conditions will affect the solar panels, false otherwise
      "description": "text description of the alert detailing the weather conditions"
    },
    "instructions": [
      "instruction 1", // specific action or precaution
      "instruction 2", // specific action or precaution
      ...
    ]
  }
  
  Use the following guidelines for instructions:
  1. If the temperature exceeds 35°C, mention cooling strategies or shading options to prevent overheating.
  2. If the temperature drops below 0°C, provide instructions for preventing frost or ice buildup.
  3. If the wind speed exceeds 40 Kph, suggest measures to secure the panels against strong winds.
  4. Include regular maintenance tips, such as cleaning the panels to ensure maximum efficiency.
  5. Provide any additional instructions relevant to the given weather data.
  
  Use the following weather data:
  
  ${JSON.stringify(weatherData)}
  `;

  try {
    const response = await instructionsModel.generateContent([
      { text: structuredPrompt },
    ]);
    const output = JSON.parse(response.response.text());
    res.json(output);
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
