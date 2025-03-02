require("dotenv").config();  
const express = require("express");  
const bcrypt = require("bcrypt");  
const jwt = require("jsonwebtoken");  
const mongoose = require("mongoose");  
const cors = require("cors");  
const multer = require("multer");  
const path = require("path");  

const app = express();  
app.use(express.json());  

// CORS Configuration  
const corsOptions = {  
  origin: "http://localhost:3000", // Your frontend URL  
  methods: ["GET", "POST", "PUT", "DELETE"],  
  credentials: true,  
};  
app.use(cors(corsOptions));  

// Load environment variables  
const mongoUri = process.env.MONGO_URI;  
const jwtSecret = process.env.JWT_SECRET;  
const port = process.env.PORT || 5000;  

// Check for required environment variables  
if (!mongoUri || !jwtSecret) {  
  console.error("Missing required environment variable.");  
  process.exit(1); // Exit if there's a configuration issue  
}  

// MongoDB Connection  
mongoose  
  .connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })  
  .then(() => console.log("Connected to MongoDB"))  
  .catch((err) => console.error("MongoDB connection error:", err));  

// User Schemas  
const adminSchema = new mongoose.Schema({  
  email: { type: String, required: true, unique: true },  
  name: { type: String, required: true },  
  password: { type: String, required: true },  
  adminPrivileges: { type: [String], default: [] },  
});  

const attendeeSchema = new mongoose.Schema({  
  email: { type: String, required: true, unique: true },  
  name: { type: String, required: true },  
  password: { type: String, required: true },  
  ticketsBooked: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],  
});  

const eventOrganizerSchema = new mongoose.Schema({  
  email: { type: String, required: true, unique: true },  
  name: { type: String, required: true },  
  password: { type: String, required: true },  
  organizedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],  
});  

const staffSchema = new mongoose.Schema({  
  email: { type: String, required: true, unique: true },  
  name: { type: String, required: true },  
  password: { type: String, required: true },  
  assignedTasks: [{ type: String }],  
});  

// Event Schema  
const eventSchema = new mongoose.Schema({  
  eventName: { type: String, required: true },  
  description: { type: String, required: true },  
  category: { type: String, required: true },  
  eventDate: { type: Date, required: true },  
  time: { type: String, required: true },  
  duration: { type: String, required: true },  
  promotionalImage: { type: String, required: true }, // URL for the uploaded image  
  bannerImage: { type: String, required: true }, // URL for the uploaded banner  
});  

// Models  
const Admin = mongoose.model("Admin", adminSchema);  
const Attendee = mongoose.model("Attendee", attendeeSchema);  
const EventOrganizer = mongoose.model("EventOrganizer", eventOrganizerSchema);  
const Staff = mongoose.model("Staff", staffSchema);  
const Event = mongoose.model("Event", eventSchema);  

// Function to get user model  
const getUserModel = (role) => {  
  switch (role) {  
    case "Admin": return Admin;  
    case "Attendee": return Attendee;  
    case "Event Organizer": return EventOrganizer;  
    case "Staff": return Staff;  
    default: return null;  
  }  
};  

// File Storage Setup for Event Images  
const storage = multer.diskStorage({  
  destination: (req, file, cb) => {  
    cb(null, 'uploads/'); // Must create this folder  
  },  
  filename: (req, file, cb) => {  
    cb(null, Date.now() + path.extname(file.originalname)); // Append timestamp to file name  
  },  
});  

const upload = multer({ storage });  

// Root Route  
app.get("/", (req, res) => {  
  res.send("Welcome to the CrowdEase API!");  
});  

// Register API  
app.post("/api/register", async (req, res) => {  
  const { email, name, role, password } = req.body;  

  try {  
    const validRoles = ["Admin", "Attendee", "Event Organizer", "Staff"];  
    if (!validRoles.includes(role)) {  
      return res.status(400).json({ message: "Invalid role selected" });  
    }  

    // Hash password  
    const hashedPassword = await bcrypt.hash(password, 10);  
    const userModel = getUserModel(role);  

    // Check if user already exists  
    if (await userModel.findOne({ email })) {  
      return res.status(400).json({ message: `${role} already exists` });  
    }  

    const newUser = new userModel({ email, name, password: hashedPassword });  
    await newUser.save();  

    res.status(201).json({ message: `${role} registered successfully` });  
  } catch (err) {  
    console.error(err);  
    res.status(500).json({ message: "Server error", error: err.message });  
  }  
});  

// Login API  
app.post("/api/login", async (req, res) => {  
  const { email, password, role } = req.body;  

  try {  
    const userModel = getUserModel(role);  
    if (!userModel) {  
      return res.status(400).json({ message: "Invalid role selected" });  
    }  

    const user = await userModel.findOne({ email });  
    if (!user) {  
      return res.status(401).json({ message: "Invalid email or password" });  
    }  

    const isMatch = await bcrypt.compare(password, user.password);  
    if (!isMatch) {  
      return res.status(401).json({ message: "Invalid email or password" });  
    }  

    const token = jwt.sign({ id: user._id, role: role }, jwtSecret, { expiresIn: "1h" });  
    res.status(200).json({ message: "Login successful", token, user: { email: user.email, name: user.name, role } });  
  } catch (err) {  
    console.error(err);  
    res.status(500).json({ message: "Server error", error: err.message });  
  }  
});  

// Logout API  
app.post("/api/logout", (req, res) => {  
  res.clearCookie("token");  
  res.status(200).json({ message: "Logged out successfully" });  
});  

// Create Event API  
app.post("/api/events", upload.fields([{ name: 'promotionalImage' }, { name: 'bannerImage' }]), async (req, res) => {  
  try {  
    const { eventName, description, category, eventDate, time, duration } = req.body;  

    const promotionalImage = req.files.promotionalImage[0].path; // Path to uploaded promotional image  
    const bannerImage = req.files.bannerImage[0].path; // Path to uploaded banner image  

    // Create new event object  
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

    await newEvent.save(); // Save the new event to the database  

    res.status(201).json({ message: "Event created successfully", event: newEvent });  
  } catch (err) {  
    console.error(err);  
    res.status(500).json({ message: "Error creating event", error: err.message });  
  }  
});  

// Start Server  
app.listen(port, () => console.log(`Server running on port ${port}`));  