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
  entrances: [{ row: Number, col: Number }],
  exits: [{ row: Number, col: Number }],
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
const ticketSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
  attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  seatId: { type: String, required: true },
  price: { type: Number, required: true },
  purchasedAt: { type: Date, default: Date.now },
});

const Ticket = mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);

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
// ✅ ADD THIS FUNCTION AT THE TOP of your file (outside the route handler)
// at top of your file, above the POST /api/events route
function generateSeats(sectionName, rows, seatsPerRow) {
  const layout = [];
  for (let r = 0; r < rows; r++) {
    const rowNum = r + 1;
    const rowLabel = String.fromCharCode(64 + rowNum); // A, B, ...
    for (let s = 1; s <= seatsPerRow; s++) {
      layout.push({
        id: `${sectionName}-${rowLabel}${s}`, // Unique ID per section
        row: rowNum,
        column: s,
        type: sectionName.toLowerCase(),
        occupied: false,
        attendee: null,
      });
    }
  }
  return layout;
}

// ✅ Your existing POST route
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

      // ✅ REPLACE THIS:
      // const seatingLayout = JSON.parse(req.body.seatingLayout || "[]");

      // ✅ WITH THIS:
      const seatSections = JSON.parse(req.body.seatSections || "[]");
      if (!Array.isArray(seatSections)) {
        return res.status(400).json({ message: "Invalid seatSections format." });
      }

      let seatingLayout = [];
      seatSections.forEach((section) => {
        // you may validate section.sectionName, section.rows, section.seatsPerRow here
        seatingLayout = seatingLayout.concat(
          generateSeats(
            section.sectionName,
            section.rows,
            section.seatsPerRow
          )
        );
      });

      // ✅ Keep this
      if (!req.files.promotionalImage || !req.files.bannerImage || !req.files.venueImage) {
        return res.status(400).json({ message: "Missing required images: promotionalImage, bannerImage, or venueImage." });
      }

      const promotionalImageUrl = await uploadToImgBB(req.files.promotionalImage[0]);
      const bannerImageUrl = await uploadToImgBB(req.files.bannerImage[0]);
      const venueImageUrl = await uploadToImgBB(req.files.venueImage[0]);



      const { entrances = [], exits = [] } = req.body;

      // Then later in the Venue creation:
      const venue = new Venue({
        venueName,
        maxCapacity: parseInt(maxCapacity, 10),
        seatingType,
        seatingLayout: JSON.stringify(seatingLayout),
        image: venueImageUrl,
        entrances,
        exits,
      });
      await venue.save();

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
{/*app.put("/api/events/:eventId/book-seats", authMiddleware, async (req, res) => {
  const { eventId } = req.params;
  const { seatIds } = req.body;

  try {
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Count seats already booked by this attendee
    const seatsBookedByUser = event.seatingLayout.filter(
      (seat) => seat.attendee?.toString() === req.user.id
    );

    if (seatsBookedByUser.length + seatIds.length > 6) {
      return res.status(400).json({ message: "You can only book up to 6 seats per event." });
    }

    // Check for already occupied seats in the request
    const alreadyBookedSeats = seatIds.filter((seatId) =>
      event.seatingLayout.find((seat) => seat.id === seatId && seat.occupied)
    );
    if (alreadyBookedSeats.length > 0) {
      return res.status(400).json({
        message: `Some seats are already booked: ${alreadyBookedSeats.join(", ")}`,
      });
    }

    seatIds.forEach((seatId) => {
      const seat = event.seatingLayout.find((seat) => seat.id === seatId);
      if (seat && !seat.occupied) {
        seat.occupied = true;
        seat.attendee = req.user.id;
      }
    });

    await event.save();
    res.status(200).json({ message: "Seats booked successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
*/}


// Book Seats
// Book Seats
// Book Seats
app.put("/api/events/:eventId/book-seats", authMiddleware, async (req, res) => {
  const { eventId } = req.params;
  const { seatIds } = req.body;

  try {
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const venue = await Venue.findOne({ eventId });
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const seatsBookedByUser = event.seatingLayout.filter(
      (seat) => seat.attendee?.toString() === req.user.id
    );

    if (seatsBookedByUser.length + seatIds.length > 6) {
      return res.status(400).json({ message: "You can only book up to 6 seats per event." });
    }

    const alreadyBookedSeats = seatIds.filter((seatId) =>
      event.seatingLayout.find((seat) => seat.id === seatId && seat.occupied)
    );
    if (alreadyBookedSeats.length > 0) {
      return res.status(400).json({
        message: `Some seats are already booked: ${alreadyBookedSeats.join(", ")}`,
      });
    }

    seatIds.forEach((seatId) => {
      const seat = event.seatingLayout.find((seat) => seat.id === seatId);
      if (seat && !seat.occupied) {
        seat.occupied = true;
        seat.attendee = req.user.id;
      }
    });

    await event.save();
    res.status(200).json({
      message: "Seats booked successfully",
      bookedSeats: seatIds,
      entrances: venue.entrances,
      layout: event.seatingLayout, // optional for frontend visualization
    });
  } catch (err) {
    console.error("Booking Error:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Book Seats
// Book Seats
// Book Seats
app.post("/api/bookings", authMiddleware, async (req, res) => {
  try {
    const { eventId, seatIds, attendeeId } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const venue = await Venue.findOne({ eventId });
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const alreadyBooked = seatIds.filter(id =>
      event.seatingLayout.find(seat => seat.id === id && seat.occupied)
    );
    if (alreadyBooked.length > 0) {
      return res.status(400).json({
        message: `Seats already booked: ${alreadyBooked.join(", ")}`
      });
    }

    const updatedLayout = event.seatingLayout.map((seat) => {
      if (seatIds.includes(seat.id)) {
        return {
          ...seat,
          occupied: true,
          attendee: attendeeId,
        };
      }
      return seat;
    });

    event.seatingLayout = updatedLayout;
    event.markModified('seatingLayout');
    await event.save();

    res.status(200).json({
      message: "Booking successful",
      bookedSeats: seatIds,
      entrances: venue.entrances,
      layout: updatedLayout,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || "Booking failed" });
  }
});

app.get("/api/tickets/:ticketId", authMiddleware, async (req, res) => {
  const { ticketId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    return res.status(400).json({ message: "Invalid ticket ID format." });
  }

  try {
    const ticket = await Ticket.findById(ticketId)
      .populate("attendeeId", "name email")
      .populate("eventId");

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    res.status(200).json(ticket);
  } catch (err) {
    console.error("Error fetching ticket:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.get('/api/tickets', authMiddleware, async (req, res) => {
  try {
    const tickets = await Ticket.find({ userId: req.user.id }); // Filter by logged-in user
    res.json(tickets);
  } catch (error) {
    console.error('Failed to fetch tickets:', error);
    res.status(500).send('Server Error');
  }
});

// DELETE any event as admin
app.delete("/api/admin/delete-event/:eventId", authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userRole = req.user.role;

    if (userRole !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }

    const deleted = await Event.findByIdAndDelete(eventId);

    if (!deleted) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json({ message: "Event deleted by admin" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Start Server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});


module.exports = app;