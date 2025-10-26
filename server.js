require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const axios = require("axios");
const { createCanvas } = require("canvas");
const fs = require("fs").promises;
const path = require("path");

const app = express();
app.use(express.json());

// Database connection pool
const pool = mysql.createPool({
  uri: process.env.DB_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Initialize database
async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        capital VARCHAR(255),
        region VARCHAR(100),
        population BIGINT NOT NULL,
        currency_code VARCHAR(10),
        exchange_rate DECIMAL(15, 4),
        estimated_gdp DECIMAL(20, 2),
        flag_url TEXT,
        last_refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_region (region),
        INDEX idx_currency (currency_code)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS refresh_metadata (
        id INT PRIMARY KEY DEFAULT 1,
        last_refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total_countries INT DEFAULT 0,
        CHECK (id = 1)
      )
    `);

    // Initialize metadata if not exists
    await connection.query(`
      INSERT IGNORE INTO refresh_metadata (id, total_countries) VALUES (1, 0)
    `);

    console.log("Database initialized successfully");
  } finally {
    connection.release();
  }
}

// Ensure cache directory exists
async function ensureCacheDir() {
  const cacheDir = path.join(__dirname, "cache");
  try {
    await fs.access(cacheDir);
  } catch {
    await fs.mkdir(cacheDir, { recursive: true });
  }
}

// Generate summary image
async function generateSummaryImage(totalCountries, topCountries, timestamp) {
  const width = 800;
  const height = 600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 32px Arial";
  ctx.fillText("Country Data Summary", 40, 60);

  // Total countries
  ctx.font = "24px Arial";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`Total Countries: ${totalCountries}`, 40, 110);

  // Timestamp
  ctx.font = "18px Arial";
  ctx.fillText(
    `Last Updated: ${new Date(timestamp).toLocaleString()}`,
    40,
    145
  );

  // Top 5 countries header
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 24px Arial";
  ctx.fillText("Top 5 Countries by Estimated GDP", 40, 200);

  // Draw top countries
  ctx.font = "18px Arial";
  let yPos = 240;
  topCountries.forEach((country, index) => {
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`${index + 1}. ${country.name}`, 60, yPos);

    ctx.fillStyle = "#94a3b8";
    const gdp = country.estimated_gdp
      ? `$${(country.estimated_gdp / 1e9).toFixed(2)}B`
      : "N/A";
    ctx.fillText(gdp, 60, yPos + 25);

    yPos += 70;
  });

  // Save image
  await ensureCacheDir();
  const buffer = canvas.toBuffer("image/png");
  await fs.writeFile(path.join(__dirname, "cache", "summary.png"), buffer);
}

// POST /countries/refresh
app.post("/countries/refresh", async (req, res) => {
  try {
    // Check if we already have data in the database
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM countries"
    );
    const currentCount = countResult[0].total;

    // If we have 250 countries, respond immediately without refreshing
    if (currentCount >= 250) {
      const [metadata] = await pool.query(
        "SELECT last_refreshed_at FROM refresh_metadata WHERE id = 1"
      );

      return res.json({
        message: "Countries data already up to date",
        total_countries: currentCount,
        last_refreshed_at: metadata[0].last_refreshed_at,
      });
    }

    // If we have some data, respond immediately and refresh in background
    if (currentCount > 0) {
      const [metadata] = await pool.query(
        "SELECT last_refreshed_at FROM refresh_metadata WHERE id = 1"
      );

      // Send response immediately
      res.json({
        message: "Countries data refresh started in background",
        total_countries: currentCount,
        last_refreshed_at: metadata[0].last_refreshed_at,
      });

      // Continue refresh in background (don't await)
      performRefresh().catch((err) =>
        console.error("Background refresh error:", err)
      );
      return;
    }

    // No data exists, perform synchronous refresh
    await performRefresh();

    const [finalMetadata] = await pool.query(
      "SELECT total_countries, last_refreshed_at FROM refresh_metadata WHERE id = 1"
    );

    res.json({
      message: "Countries data refreshed successfully",
      total_countries: finalMetadata[0].total_countries,
      last_refreshed_at: finalMetadata[0].last_refreshed_at,
    });
  } catch (error) {
    console.error("Refresh error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Separate function for the actual refresh logic
async function performRefresh() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Fetch countries data and exchange rates concurrently
    const [countriesResponse, ratesResponse] = await Promise.all([
      axios.get(
        "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies",
        { timeout: 10000 }
      ),
      axios.get("https://open.er-api.com/v6/latest/USD", { timeout: 10000 }),
    ]);

    const countries = countriesResponse.data;
    const rates = ratesResponse.data.rates;

    for (const country of countries) {
      let currencyCode = null;
      let exchangeRate = null;
      let estimatedGdp = null;

      // Extract currency code
      if (country.currencies && country.currencies.length > 0) {
        currencyCode = country.currencies[0].code;

        // Get exchange rate
        if (rates[currencyCode]) {
          exchangeRate = rates[currencyCode];

          // Calculate estimated GDP
          const randomMultiplier = Math.random() * 1000 + 1000; // 1000-2000
          estimatedGdp = (country.population * randomMultiplier) / exchangeRate;
        }
      } else {
        // No currencies - set GDP to 0
        estimatedGdp = 0;
      }

      // Upsert country
      await connection.query(
        `
        INSERT INTO countries (
          name, capital, region, population, currency_code, 
          exchange_rate, estimated_gdp, flag_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          capital = VALUES(capital),
          region = VALUES(region),
          population = VALUES(population),
          currency_code = VALUES(currency_code),
          exchange_rate = VALUES(exchange_rate),
          estimated_gdp = VALUES(estimated_gdp),
          flag_url = VALUES(flag_url),
          last_refreshed_at = CURRENT_TIMESTAMP
      `,
        [
          country.name,
          country.capital || null,
          country.region || null,
          country.population,
          currencyCode,
          exchangeRate,
          estimatedGdp,
          country.flag || null,
        ]
      );
    }

    // Update metadata
    const [countResult] = await connection.query(
      "SELECT COUNT(*) as total FROM countries"
    );
    const totalCountries = countResult[0].total;

    await connection.query(
      `
      UPDATE refresh_metadata 
      SET last_refreshed_at = CURRENT_TIMESTAMP, total_countries = ?
      WHERE id = 1
    `,
      [totalCountries]
    );

    await connection.commit();

    // Generate summary image
    const [topCountries] = await connection.query(`
      SELECT name, estimated_gdp 
      FROM countries 
      WHERE estimated_gdp IS NOT NULL
      ORDER BY estimated_gdp DESC 
      LIMIT 5
    `);

    const [metadata] = await connection.query(
      "SELECT last_refreshed_at FROM refresh_metadata WHERE id = 1"
    );

    await generateSummaryImage(
      totalCountries,
      topCountries,
      metadata[0].last_refreshed_at
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// GET /countries
app.get("/countries", async (req, res) => {
  try {
    const { region, currency, sort } = req.query;

    let query = "SELECT * FROM countries WHERE 1=1";
    const params = [];

    if (region) {
      query += " AND region = ?";
      params.push(region);
    }

    if (currency) {
      query += " AND currency_code = ?";
      params.push(currency);
    }

    // Sorting
    if (sort === "gdp_desc") {
      query += " ORDER BY estimated_gdp DESC";
    } else if (sort === "gdp_asc") {
      query += " ORDER BY estimated_gdp ASC";
    } else if (sort === "population_desc") {
      query += " ORDER BY population DESC";
    } else if (sort === "population_asc") {
      query += " ORDER BY population ASC";
    } else if (sort === "name_asc") {
      query += " ORDER BY name ASC";
    } else if (sort === "name_desc") {
      query += " ORDER BY name DESC";
    }

    const [countries] = await pool.query(query, params);

    res.json(countries);
  } catch (error) {
    console.error("Get countries error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /countries/:name
app.get("/countries/:name", async (req, res) => {
  try {
    const [countries] = await pool.query(
      "SELECT * FROM countries WHERE LOWER(name) = LOWER(?)",
      [req.params.name]
    );

    if (countries.length === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    res.json(countries[0]);
  } catch (error) {
    console.error("Get country error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /countries/:name
app.delete("/countries/:name", async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM countries WHERE LOWER(name) = LOWER(?)",
      [req.params.name]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    // Update total count in metadata
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM countries"
    );
    await pool.query(
      "UPDATE refresh_metadata SET total_countries = ? WHERE id = 1",
      [countResult[0].total]
    );

    res.json({ message: "Country deleted successfully" });
  } catch (error) {
    console.error("Delete country error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /status
app.get("/status", async (req, res) => {
  try {
    const [metadata] = await pool.query(
      "SELECT total_countries, last_refreshed_at FROM refresh_metadata WHERE id = 1"
    );

    res.json({
      total_countries: metadata[0].total_countries,
      last_refreshed_at: metadata[0].last_refreshed_at,
    });
  } catch (error) {
    console.error("Status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /countries/image
app.get("/countries/image", async (req, res) => {
  try {
    const imagePath = path.join(__dirname, "cache", "summary.png");
    await fs.access(imagePath);
    res.sendFile(imagePath);
  } catch (error) {
    res.status(404).json({ error: "Summary image not found" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDatabase();
    await ensureCacheDir();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
