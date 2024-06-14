const express = require('express');
const OpenAI = require("openai");
const axios = require('axios');
const bodyParser = require('body-parser');
const { Parser } = require('json2csv');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = 3000;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

// Store conversation history for each session
const sessions = {};

// Endpoint to create a new session and return the session ID
app.get('/create_session', (req, res) => {
  const sessionId = uuidv4();
  sessions[sessionId] = [];
  res.json({ sessionId });
});

app.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!message) {
    return res.status(400).send('No message provided');
  }

  let currentSessionId = sessionId;

  // Check if the provided session ID exists, if not create a new one
  if (!currentSessionId) {
    currentSessionId = uuidv4();
    sessions[currentSessionId] = [];
  }
  if(!sessions[currentSessionId]){
    currentSessionId = req.body.sessionId;
    sessions[currentSessionId] = [];
  }

  // Append the new message to the session's conversation history
  sessions[currentSessionId].push({
    role: "user",
    content: [
      {
        type: "text",
        text: message
      }
    ]
  });

  try {
    const response = await openai.chat.completions.create({
      model: "ft:gpt-3.5-turbo-0125:personal::9X3nW56n",
      messages: sessions[currentSessionId],
      temperature: 1,
      max_tokens: 256,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    // Append the assistant's response to the session's conversation history
    sessions[currentSessionId].push({
      role: "assistant",
      content: response.choices[0].message.content,
    });

    res.json({
      sessionId: currentSessionId,
      response: response.choices[0].message.content
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('An error occurred');
  }
});


const MODEL_API_ENDPOINT = 'https://run.mocky.io/v3/8c3b6f8a-afb0-414a-8bfa-8c75b7043e1d';

app.post('/predicted', async (req, res) => {
  const { lat, lon } = req.body;

  if (!lat || !lon) {
      return res.status(400).send({ error: 'Latitude and longitude are required' });
  }

  try {
      // Fetch weather data from OpenWeatherMap API
      const weatherResponse = await axios.get(`https://api.weatherapi.com/v1/forecast.json?q=${lat},${lon}&days=11&alerts=no&aqi=no&tp=24&key=${process.env.API_KEY}`);
      const weatherData = weatherResponse.data;
      const forecastDays = weatherData.forecast.forecastday;    
      
      function calculateOutputReduction(avgTmp) {
        let reduction = 0;
        if (avgTmp > 25) {
          reduction = (avgTmp - 25) * 0.5;
        }
        return reduction;
      }

      const outputReductions = forecastDays.map(day => calculateOutputReduction(day.day.avgtemp_c));

      const location = {
        region: weatherData.location.region,
        country: weatherData.location.country
    };

      const currentWeather = {
          date: forecastDays[0].date,
          temp: weatherData.current.temp_c,
          condition: weatherData.current.condition.text,
          windSpeed: weatherData.current.wind_kph,
          windDirection: weatherData.current.wind_dir,
          humidity: weatherData.current.humidity,
          feelsLike: weatherData.current.feelslike_c,
          minTemp: forecastDays[0].day.mintemp_c,
          maxTemp: forecastDays[0].day.maxtemp_c
      };

      const forecast = forecastDays.map(day => ({
        date: day.date,
        temp: day.day.avgtemp_c,
        condition: day.day.condition.text,
        windSpeed: day.day.maxwind_kph, 
        humidity: day.day.avghumidity,
        minTemp: day.day.mintemp_c,
        maxTemp: day.day.maxtemp_c
      }));

      res.json({ location, current: currentWeather, forecast, output: outputReductions });

  } catch (error) {
      console.error(error);
      res.status(500).send({ error: 'An error occurred' });
  }
});

      // Extract relevant data
      // const data = [{
      //     temp: weatherData.main.temp,
      //     humidity: weatherData.main.humidity,
      //     pressure: weatherData.main.pressure,
      //     wind_speed: weatherData.wind.speed,
      //     // Add more fields if necessary
      // }];

      // Convert JSON to CSV
      // const json2csvParser = new Parser();
      // const csv = json2csvParser.parse(data);

      // // Send CSV data to model API
      // const modelResponse = await axios.post(MODEL_API_ENDPOINT, csv, {
      //     headers: {
      //         'Content-Type': 'text/csv'
      //     }
      // });

      // Respond with model output
      

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
