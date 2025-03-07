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

const corsOptions = {  
  origin: "https://crowdease-frontend.vercel.app",  
  methods: ["GET", "POST", "PUT", "DELETE"],  
  allowedHeaders: ["Content-Type", "Authorization"],  
  credentials: true,  
};  
app.use(cors(corsOptions));  

const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/crowdease";  
const jwtSecret = process.env.JWT_SECRET || "your_secret_key";  
const imgBBKey = process.env.IMGBB_API_KEY || "your_imgbb_api_key";  
const port = process.env.PORT || 5000;  

mongoose  
  .connect(mongoUri)  
  .then(() => console.log("Connected to MongoDB"))  
  .catch((err) => console.error("MongoDB connection error:", err));  

// User Schema  
const userSchema = new mongoose.Schema({  
  email: { type: String, required: true, unique: true },  
  name: { type: String, required: true },  
  password: { type: String, required: true },  
  role: { type: String, enum: ["Admin", "Attendee", "Event Organizer", "Staff"], required: true },  
});  

// Event Schema (removed organizerId)  
const eventSchema = new mongoose.Schema({  
  eventName: { type: String, required: true },  
  description: { type: String, required: true },  
  category: { type: String, required: true },  
  eventDate: { type: Date, required: true },  
  time: { type: String, required: true },  
  duration: { type: String, required: true },  
  promotionalImage: { type: String, required: true },  
  bannerImage: { type: String, required: true },  
});  

// Venue Schema (removed createdBy)  
const venueSchema = new mongoose.Schema({  
  venueName: { type: String, required: true },  
  maxCapacity: { type: Number, required: true },  
  seatingType: { type: String, enum: ["seatSelection", "noPreference"], required: true },  
});  

// Models  
const User = mongoose.models.User || mongoose.model("User", userSchema);  
const Event = mongoose.models.Event || mongoose.model("Event", eventSchema);  
const Venue = mongoose.models.Venue || mongoose.model("Venue", venueSchema);  

// Multer Memory Storage  
const upload = multer({ storage: multer.memoryStorage() });  

// Upload to ImgBB  
const uploadToImgBB = async (file) => {  
  try {  
    const formData = new FormData();  
    formData.append("image", file.buffer.toString("base64"));  

    const response = await axios.post("https://api.imgbb.com/1/upload", formData, {  
      headers: formData.getHeaders(),  
      params: { key: imgBBKey },  
    });  

    return response.data.data.url;  
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
    if (!user) return res.status(400).json({ message: "Invalid email or password" });  

    const isMatch = await bcrypt.compare(password, user.password);  
    if (!isMatch) return res.status(400).json({ message: "Invalid email or password" });  

    const token = jwt.sign({ id: user._id, role: user.role }, jwtSecret, { expiresIn: "1h" });  

    res.status(200).json({ message: "Login successful", token, user });  
  } catch (err) {  
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

    if (await User.findOne({ email })) return res.status(400).json({ message: "User already exists" });  

    const hashedPassword = await bcrypt.hash(password, 10);  
    const newUser = new User({ email, name, role, password: hashedPassword });  

    await newUser.save();  
    res.status(201).json({ message: "User registered successfully" });  
  } catch (err) {  
    res.status(500).json({ message: "Server error", error: err.message });  
  }  
});  

// Create Venue API (no authentication)  
app.post("/api/venues", async (req, res) => {  
  const { venueName, maxCapacity, seatingType } = req.body;  

  try {  
    const newVenue = new Venue({ venueName, maxCapacity, seatingType });  
    await newVenue.save();  
    res.status(201).json({ message: "Venue created successfully", venue: newVenue });  
  } catch (err) {  
    res.status(500).json({ message: "Server error while creating venue", error: err.message });  
  }  
});  

// Create Event API (no authentication)  
app.post("/api/events", upload.fields([{ name: "promotionalImage" }, { name: "bannerImage" }]), async (req, res) => {  
  try {  
    const { eventName, description, category, eventDate, time, duration } = req.body;  

    // Ensure required fields are present  
    if (!eventName || !description || !category || !eventDate || !time || !duration) {  
      return res.status(400).json({ message: "All event details are required." });  
    }  

    // Ensure images are uploaded  
    if (!req.files || !req.files.promotionalImage || !req.files.bannerImage) {  
      return res.status(400).json({ message: "Both promotional and banner images are required." });  
    }  

    // Upload images to ImgBB  
    let promotionalImage, bannerImage;  
    try {  
      promotionalImage = await uploadToImgBB(req.files.promotionalImage[0]);  
      bannerImage = await uploadToImgBB(req.files.bannerImage[0]);  
    } catch (imgErr) {  
      console.error("Image upload failed:", imgErr);  
      return res.status(500).json({ message: "Image upload failed", error: imgErr.message });  
    }  

    // Create and save event  
    const newEvent = new Event({  
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
    res.status(500).json({ message: "Server error while creating event", error: err.message });  
  }  
});  

// Start the server  
app.listen(port, () => {  
  console.log(`Server is running on http://localhost:${port}`);  
});  

// Export for Vercel  
module.exports = app;  