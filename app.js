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

  // Initialize session if it doesn't exist
  if (!sessions[currentSessionId]) {
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

  const structuredPrompt = `You are to generate instructions for managing solar panels based on the following weather data (temperature is in Celsius, and wind speed is in Kph). The response should be short, concise, and in JSON object format and not JSON string. Provide an alert indicating if the weather will affect the solar panels and a list of instructions to ensure the panels are not damaged and produce optimal output, try to give as many instructions as possible but keep it under 7 instructions. The response must be in the following json structure with the same keys and data types as shown below:
{
 "alert": {
   "isActive": Boolean, // true if the weather will affect the panels, false otherwise
   "description": "text description of the alert"
 },
 "instructions": [
   "instruction 1",
   "instruction 2",
   ...
 ]
}

Use the following weather data:

${JSON.stringify(weatherData)}`;

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
