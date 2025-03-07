require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
app.use(express.json());

// CORS Configuration for Vercel
const corsOptions = {
  origin: "https://crowdease-frontend.vercel.app", // Change this to your frontend domain in production
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));

// Load environment variables
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/crowdease";
const jwtSecret = process.env.JWT_SECRET || "your_secret_key";
const imgBBKey = process.env.IMGBB_API_KEY || "your_imgbb_api_key";
const port = process.env.PORT || 5000;

// MongoDB Connection
mongoose
  .connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["Admin", "Attendee", "Event Organizer", "Staff"], required: true },
});

// Event Schema
const eventSchema = new mongoose.Schema({
  organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  eventName: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  eventDate: { type: Date, required: true },
  time: { type: String, required: true },
  duration: { type: String, required: true },
  promotionalImage: { type: String, required: true },
  bannerImage: { type: String, required: true },
});

// Models
const User = mongoose.model("User", userSchema);
const Event = mongoose.model("Event", eventSchema);

// Multer Memory Storage (since Vercel doesn't support file uploads)
const upload = multer({ storage: multer.memoryStorage() });

// Upload Image to ImgBB
const uploadToImgBB = async (file) => {
  try {
    const formData = new FormData();
    formData.append("image", file.buffer.toString("base64"));

    const response = await axios.post("https://api.imgbb.com/1/upload", formData, {
      headers: formData.getHeaders(),
      params: { key: imgBBKey },
    });

    return response.data.data.url; // Returns the hosted image URL
  } catch (error) {
    console.error("ImgBB Upload Error:", error.response?.data || error.message);
    throw new Error("Failed to upload image");
  }
};

// Root Route
app.get("/", (req, res) => res.send("Welcome to the CrowdEase API!"));

// Login API
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, jwtSecret, { expiresIn: "1h" });

    res.status(200).json({ message: "Login successful", token, user });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Register API
app.post("/api/register", async (req, res) => {
  const { email, name, role, password } = req.body;

  try {
    if (!["Admin", "Attendee", "Event Organizer", "Staff"].includes(role)) {
      return res.status(400).json({ message: "Invalid role selected" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = new User({ email, name, role, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Middleware to enforce single-event rule
const checkSingleEventRule = async (req, res, next) => {
  try {
    const { organizerId } = req.body;
    const existingEvent = await Event.findOne({ organizerId });

    if (existingEvent) {
      return res.status(400).json({ message: "You can only create one event at a time." });
    }
    next();
  } catch (error) {
    console.error("Error checking existing event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Create Event API (Uses ImgBB)
app.post("/api/events", checkSingleEventRule, upload.fields([{ name: "promotionalImage" }, { name: "bannerImage" }]), async (req, res) => {
  try {
    console.log("Incoming Event Data:", req.body);
    console.log("Uploaded Files:", req.files);

    const { organizerId, eventName, description, category, eventDate, time, duration } = req.body;
    if (!req.files || !req.files.promotionalImage || !req.files.bannerImage) {
      return res.status(400).json({ message: "Both promotional and banner images are required." });
    }

    // Upload images to ImgBB
    const promotionalImage = await uploadToImgBB(req.files.promotionalImage[0]);
    const bannerImage = await uploadToImgBB(req.files.bannerImage[0]);

    const newEvent = new Event({
      organizerId,
      eventName,
      description,
      category,
      eventDate,
      time,
      duration,
      promotionalImage,
      bannerImage,
    });

    await newEvent.save();
    res.status(201).json({ message: "Event created successfully", event: newEvent });
  } catch (err) {
    console.error("Error saving event:", err.message);
    res.status(500).json({ message: "Server error while creating event", error: err.message });
  }
});

// Export for Vercel
module.exports = app;
