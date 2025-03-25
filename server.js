require("dotenv").config();  
const express = require("express");  
const bcrypt = require("bcryptjs");  
const jwt = require("jsonwebtoken");  
const mongoose = require("mongoose");  
const cors = require("cors");  
const multer = require("multer");  
const axios = require("axios");  
const FormData = require("form-data");  
const authMiddleware = require("./authMiddleware");


const app = express();  
app.use(express.json());  

const corsOptions = {  
  origin: ["http://localhost:3000", "https://crowdease-frontend.vercel.app"],  
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

// Event Schema  
const eventSchema = new mongoose.Schema({  
  eventName: { type: String, required: true },  
  description: { type: String, required: true },  
  category: { type: String, required: true },  
  eventDate: { type: Date, required: true },  
  time: { type: String, required: true },  
  duration: { type: String, required: true },  
  promotionalImage: { type: String, required: true },  
  bannerImage: { type: String, required: true },  
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue' }, // Reference to Venue  
  organizerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to User  
});  

// Venue Schema  
const venueSchema = new mongoose.Schema({  
  venueName: { type: String, required: true },  
  maxCapacity: { type: Number, required: true },  
  seatingType: {  
    type: String,  
    enum: ["seatSelection", "noPreference"],  
    required: true,  
  },  
  seatingLayout: { type: String }, // for seating arrangement  
  image: { type: String, required: true }, // URL for venue image  
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

// Unified Create Event API  
app.post(
  "/api/events",
  authMiddleware, // Protect this route
  upload.fields([
    { name: "promotionalImage" },
    { name: "bannerImage" },
    { name: "venueImage" },
    { name: "seatingLayout" },
    { name: "promoImage" },
  ]),
  async (req, res) => {
    try {
      const {  
        eventName,  
        description,  
        category,  
        eventDate,  
        time,  
        duration,  
        venueName,  
        maxCapacity,  
        seatingType,  
        ticketType,  
        ticketPrice,  
        discount,  
        paymentOption  
      } = req.body;  

      // Ensure required fields are present  
      if (!eventName || !description || !category || !eventDate || !time || !duration ||  
          !venueName || !maxCapacity || !seatingType || !ticketType || !ticketPrice || !paymentOption ||!discount) {  
        return res.status(400).json({ message: "All fields are required." });  
      }  

      // Get the user ID from authentication
      const userId = req.user.id; 

      // Check if the organizer already has an event  
      const existingEvent = await Event.findOne({ organizerId: userId });  
      if (existingEvent) {  
        return res.status(400).json({ message: "You can only create one event at a time." });  
      }  

      // Ensure images are uploaded  
      if (!req.files ||  
          !req.files.promotionalImage || !req.files.bannerImage ||   
          !req.files.venueImage || !req.files.seatingLayout) {  
        return res.status(400).json({ message: "All images are required." });  
      }  

      // Upload images to ImgBB  
      let promotionalImage, bannerImage, venueImageUrl, seatingLayoutUrl;  
      try {  
        promotionalImage = await uploadToImgBB(req.files.promotionalImage[0]);  
        bannerImage = await uploadToImgBB(req.files.bannerImage[0]);  
        venueImageUrl = await uploadToImgBB(req.files.venueImage[0]);  
        seatingLayoutUrl = await uploadToImgBB(req.files.seatingLayout[0]);  
      } catch (imgErr) {  
        console.error("Image upload failed:", imgErr);  
        return res.status(500).json({ message: "Image upload failed", error: imgErr.message });  
      }  

      // Create Venue  
      const newVenue = new Venue({  
        venueName,  
        maxCapacity,  
        seatingType,  
        seatingLayout: seatingLayoutUrl,  
        image: venueImageUrl,  
      });  
      await newVenue.save();  

      // Create Event  
      const newEvent = new Event({  
        eventName,  
        description,  
        category,  
        eventDate,  
        time,  
        duration,  
        promotionalImage,  
        bannerImage,  
        venueId: newVenue._id, // Save the Venue ID reference  
        organizerId: userId, // Now, it correctly assigns the logged-in user's ID  
      });  

      await newEvent.save();  

      res.status(201).json({ message: "Event created successfully", event: newEvent });  
    } catch (err) {  
      console.error("Server error while creating event:", err);  
      res.status(500).json({  
        message: "Server error while creating event",  
        error: err.message,  
      });  
    }  
  }
);
app.get("/api/events", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // Extract organizer's ID from token
    const userRole = req.user.role;

    // Check if the user is an Event Organizer
    if (userRole !== "Event Organizer") {
      return res.status(403).json({ message: "Access denied" });
    }

    // Fetch events created by the logged-in organizer
    const events = await Event.find({ organizerId: userId }).populate("venueId");

    // Return no events found if the query is empty
    if (!events.length) {
      return res.status(200).json([]);
    }

    res.status(200).json(events);
  } catch (err) {
    console.error("Error fetching events:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.put("/api/events/:eventId", authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    console.log("Request Body:", req.body);
    console.log("Event ID:", eventId, "User ID:", userId);

    const event = await Event.findOne({ _id: eventId, organizerId: userId });
    if (!event) {
      console.log("Event not found or access denied");
      return res.status(404).json({ message: "Event not found or access denied" });
    }

    // Update event details
    event.eventName = req.body.eventName || event.eventName;
    event.description = req.body.description || event.description;
    event.category = req.body.category || event.category;
    event.eventDate = req.body.eventDate || event.eventDate;
    event.time = req.body.time || event.time;
    event.duration = req.body.duration || event.duration;

    await event.save();
    console.log("Event updated successfully");
    res.status(200).json({ message: "Event updated successfully", event });
  } catch (err) {
    console.error("Error updating event:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});




app.delete("/api/events/:eventId", authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    // Check if the event exists and belongs to the organizer
    const event = await Event.findOne({ _id: eventId, organizerId: userId });
    if (!event) {
      return res.status(404).json({ message: "Event not found or access denied" });
    }

    await Event.deleteOne({ _id: eventId });
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

const blacklist = new Set(); // Temporary in-memory token blacklist (for better scalability, use Redis)

// Logout API
app.post("/api/logout", authMiddleware, (req, res) => {
  try {
    res.status(200).json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Start the server  
app.listen(port, () => {  
  console.log(`Server is running on http://localhost:${port}`);  
});  

// Export for Vercel  
module.exports = app;  