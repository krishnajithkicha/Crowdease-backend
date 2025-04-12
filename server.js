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

// CORS Configuration
const corsOptions = {
  origin: ["http://localhost:3000", "https://crowdease-frontend.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));

// Database Connection
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/crowdease";
mongoose
  .connect(mongoUri)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Constants
const jwtSecret = process.env.JWT_SECRET || "your_secret_key";
const imgBBKey = process.env.IMGBB_API_KEY || "your_imgbb_api_key";
const port = process.env.PORT || 5000;

// Schemas
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["Admin", "Attendee", "Event Organizer", "Staff"], required: true },
});

const venueSchema = new mongoose.Schema({
  venueName: { type: String, required: true },
  maxCapacity: { type: Number, required: true },
  seatingType: { type: String, enum: ["seatSelection", "noPreference"], required: true },
  seatingLayout: { type: String },
  image: { type: String, required: true },
});

const eventSchema = new mongoose.Schema({
  eventName: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  eventDate: { type: Date, required: true },
  time: { type: String, required: true },
  duration: { type: String, required: true },
  promotionalImage: { type: String, required: true },
  bannerImage: { type: String, required: true },
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: "Venue" },
  organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  seatingLayout: [
    {
      id: String,
      row: Number,
      column: Number,
      occupied: { type: Boolean, default: false },
      attendee: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
  ],
});

// Models
const User = mongoose.models.User || mongoose.model("User", userSchema);
const Event = mongoose.models.Event || mongoose.model("Event", eventSchema);
const Venue = mongoose.models.Venue || mongoose.model("Venue", venueSchema);

// Multer Configuration
const upload = multer({ storage: multer.memoryStorage() });

// Helper to Upload Images to ImgBB
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

// Routes

// Root Route
app.get("/", (req, res) => res.send("Welcome to the CrowdEase API!"));

// User Authentication APIs
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

// Event APIs

// Create Event
app.post(
  "/api/events",
  authMiddleware,
  upload.fields([
    { name: "promotionalImage" },
    { name: "bannerImage" },
    { name: "venueImage" },
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
        paymentOption,
      } = req.body;
      const seatingLayout = JSON.parse(req.body.seatingLayout || "[]");

      if (!Array.isArray(seatingLayout)) {
        return res.status(400).json({ message: "Invalid seating layout format." });
      }

      seatingLayout.forEach((seat) => {
        if (!seat.id || !Number.isInteger(seat.row) || !Number.isInteger(seat.column)) {
          throw new Error(`Invalid seat data: ${JSON.stringify(seat)}`);
        }
      });

      const userId = req.user.id;

      if (!req.files.promotionalImage || !req.files.bannerImage || !req.files.venueImage) {
        return res.status(400).json({ message: "Missing required images: promotionalImage, bannerImage, or venueImage." });
      }
      

      // Image Uploads
  const promotionalImageUrl = await uploadToImgBB(req.files.promotionalImage[0]);
  const bannerImageUrl = await uploadToImgBB(req.files.bannerImage[0]);
  const venueImageUrl = await uploadToImgBB(req.files.venueImage[0]);

  // Save Venue
  const venue = new Venue({
    venueName,
    maxCapacity: parseInt(maxCapacity, 10),
    seatingType,
    seatingLayout: JSON.stringify(seatingLayout),
    image: venueImageUrl,
  });
  await venue.save();

  // Save Event
  const newEvent = new Event({
    eventName,
    description,
    category,
    eventDate: new Date(eventDate),
    time,
    duration,
    promotionalImage: promotionalImageUrl,
    bannerImage: bannerImageUrl,
    venueId: venue._id,
    organizerId: req.user.id,
    seatingLayout,
    ticketType,
    ticketPrice: parseFloat(ticketPrice),
    discount: parseFloat(discount) || 0,
    paymentOption,
  });
  await newEvent.save();

  res.status(201).json({ message: "Event created successfully", event: newEvent });
} catch (err) {
  console.error("Event Creation Error:", err.message);
  res.status(500).json({ message: "Failed to create event", error: err.message });
}
}
);
app.get("/api/events", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // Get the organizer's ID from JWT token
    const events = await Event.find({ organizerId: userId }).populate("venueId");
    res.status(200).json(events);
  } catch (err) {
    console.error("Error fetching events:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Fetch All Events
app.get("/api/all-events", async (req, res) => {
  try {
    const events = await Event.find().populate("venueId");
    res.status(200).json(events);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Update Event
const validateObjectId = require("./validateObjectId");

app.put("/api/events/:eventId", authMiddleware, validateObjectId, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    console.log("Received Event ID:", eventId);
    console.log("Request Body:", req.body);

    // Check if the event exists and belongs to the organizer
    const event = await Event.findOne({ _id: eventId, organizerId: userId });
    if (!event) {
      return res.status(404).json({ message: "Event not found or access denied." });
    }

    // Update event details
    event.eventName = req.body.eventName || event.eventName;
    event.description = req.body.description || event.description;
    event.category = req.body.category || event.category;
    event.eventDate = req.body.eventDate || event.eventDate;
    event.time = req.body.time || event.time;
    event.duration = req.body.duration || event.duration;

    await event.save();
    console.log("Event updated successfully.");
    res.status(200).json({ message: "Event updated successfully", event });
  } catch (err) {
    console.error("Error updating event:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Update Seat Status
app.put("/api/events/:eventId/seats/:seatId", authMiddleware, async (req, res) => {
  try {
    const { eventId, seatId } = req.params;
    const { occupied, attendeeId } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const seat = event.seatingLayout.find((seat) => seat.id === seatId);
    if (!seat) return res.status(404).json({ message: "Seat not found" });

    seat.occupied = occupied || seat.occupied;
    seat.attendee = attendeeId || seat.attendee;

    await event.save();
    res.status(200).json({ message: "Seat updated successfully", seat });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Delete Event
app.delete("/api/events/:eventId", authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    const event = await Event.findOne({ _id: eventId, organizerId: userId });
    if (!event) return res.status(404).json({ message: "Event not found or access denied" });

    await Event.deleteOne({ _id: eventId });
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.get("/api/events/:eventId", async (req, res) => {
  const { eventId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return res.status(400).json({ message: "Invalid event ID format." });
  }

  try {
    const event = await Event.findById(eventId).populate("venueId");
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.status(200).json(event);
  } catch (err) {
    console.error("Error fetching event:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Start Server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});


module.exports = app;
