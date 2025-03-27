const mongoose = require("mongoose");

const validateObjectId = (req, res, next) => {
  const { eventId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return res.status(400).json({ message: "Invalid Event ID format." });
  }
  next();
};

module.exports = validateObjectId;
