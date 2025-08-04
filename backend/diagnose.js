const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
  const { noiseDesc, location, situation, makeModel, notes } = req.body;

  console.log("🛠️ Diagnostic request received:", {
    noiseDesc, location, situation, makeModel, notes
  });

  let diagnosis = "Unknown sound. Please check with a professional.";

  if (noiseDesc?.toLowerCase().includes("clunk")) {
    diagnosis = "Possible suspension issue or loose exhaust part.";
  } else if (noiseDesc?.toLowerCase().includes("squeal")) {
    diagnosis = "Worn brake pads or loose belt.";
  }

  res.json({ diagnosis });
});

module.exports = router;