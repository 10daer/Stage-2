# Country Data REST API

A RESTful API that fetches country data from external APIs, stores it in MySQL with exchange rates, and provides CRUD operations with data visualization.

## Features

- Fetch country data from REST Countries API
- Get real-time exchange rates for country currencies
- Calculate estimated GDP based on population and exchange rates
- Store and cache data in MySQL database
- Generate summary images with top countries
- Filter and sort countries by region, currency, and GDP
- Full CRUD operations

## Prerequisites

- Node.js (v14 or higher)
- MySQL (v5.7 or higher)
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd country-api
```

2. Install dependencies:
```bash
npm install
```

3. Create a MySQL database:
```sql
CREATE DATABASE countries_db;
```

4. Configure environment variables:
   - Copy `.env` file and update with your MySQL credentials:
```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=countries_db
```

5. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

### 1. Refresh Country Data
**POST** `/countries/refresh`

Fetches all countries from external APIs, calculates exchange rates and GDP, then stores in database.

**Response:**
```json
{
  "message": "Countries data refreshed successfully",
  "total_countries": 250,
  "last_refreshed_at": "2025-10-22T18:00:00Z"
}
```

**Error Responses:**
- `503 Service Unavailable` - External API unavailable

---

### 2. Get All Countries
**GET** `/countries`

Retrieve all countries with optional filtering and sorting.

**Query Parameters:**
- `region` - Filter by region (e.g., `Africa`, `Europe`, `Asia`)
- `currency` - Filter by currency code (e.g., `NGN`, `USD`, `GBP`)
- `sort` - Sort results:
  - `gdp_desc` - By GDP descending
  - `gdp_asc` - By GDP ascending
  - `population_desc` - By population descending
  - `population_asc` - By population ascending
  - `name_asc` - By name A-Z
  - `name_desc` - By name Z-A

**Example Request:**
```bash
GET /countries?region=Africa&sort=gdp_desc
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Nigeria",
    "capital": "Abuja",
    "region": "Africa",
    "population": 206139589,
    "currency_code": "NGN",
    "exchange_rate": 1600.23,
    "estimated_gdp": 25767448125.2,
    "flag_url": "https://flagcdn.com/ng.svg",
    "last_refreshed_at": "2025-10-22T18:00:00Z"
  }
]
```

---

### 3. Get Country by Name
**GET** `/countries/:name`

Retrieve a single country by name (case-insensitive).

**Example Request:**
```bash
GET /countries/Nigeria
```

**Response:**
```json
{
  "id": 1,
  "name": "Nigeria",
  "capital": "Abuja",
  "region": "Africa",
  "population": 206139589,
  "currency_code": "NGN",
  "exchange_rate": 1600.23,
  "estimated_gdp": 25767448125.2,
  "flag_url": "https://flagcdn.com/ng.svg",
  "last_refreshed_at": "2025-10-22T18:00:00Z"
}
```

**Error Responses:**
- `404 Not Found` - Country doesn't exist

---

### 4. Delete Country
**DELETE** `/countries/:name`

Delete a country record by name (case-insensitive).

**Example Request:**
```bash
DELETE /countries/Nigeria
```

**Response:**
```json
{
  "message": "Country deleted successfully"
}
```

**Error Responses:**
- `404 Not Found` - Country doesn't exist

---

### 5. Get API Status
**GET** `/status`

Get total countries count and last refresh timestamp.

**Response:**
```json
{
  "total_countries": 250,
  "last_refreshed_at": "2025-10-22T18:00:00Z"
}
```

---

### 6. Get Summary Image
**GET** `/countries/image`

Retrieve the generated summary image showing top 5 countries by GDP.

**Response:**
- PNG image file

**Error Responses:**
- `404 Not Found` - Image hasn't been generated yet (run refresh first)

---

## Data Model

### Countries Table

| Field | Type | Description |
|-------|------|-------------|
| id | INT | Auto-generated primary key |
| name | VARCHAR(255) | Country name (unique, required) |
| capital | VARCHAR(255) | Capital city (optional) |
| region | VARCHAR(100) | Geographic region (optional) |
| population | BIGINT | Population count (required) |
| currency_code | VARCHAR(10) | ISO currency code (required) |
| exchange_rate | DECIMAL(15,4) | Exchange rate vs USD (required) |
| estimated_gdp | DECIMAL(20,2) | Calculated GDP estimate |
| flag_url | TEXT | URL to country flag (optional) |
| last_refreshed_at | TIMESTAMP | Last update timestamp |

### GDP Calculation

```
estimated_gdp = (population × random(1000-2000)) ÷ exchange_rate
```

The random multiplier (1000-2000) is regenerated on each refresh to simulate GDP fluctuation.

## Currency Handling

- If a country has multiple currencies, only the first is stored
- If a country has no currencies:
  - `currency_code` = `null`
  - `exchange_rate` = `null`
  - `estimated_gdp` = `0`
- If currency code not found in exchange rates:
  - `exchange_rate` = `null`
  - `estimated_gdp` = `null`

## Error Handling

All errors return consistent JSON responses:

```json
{
  "error": "Error message",
  "details": "Optional details"
}
```

**Status Codes:**
- `200` - Success
- `400` - Bad Request (validation failed)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable (external API failure)

## External APIs

1. **REST Countries API**
   - URL: `https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies`
   - Provides country data

2. **Exchange Rates API**
   - URL: `https://open.er-api.com/v6/latest/USD`
   - Provides currency exchange rates vs USD

## Testing the API

### Using cURL

1. Refresh data:
```bash
curl -X POST http://localhost:3000/countries/refresh
```

2. Get all African countries sorted by GDP:
```bash
curl "http://localhost:3000/countries?region=Africa&sort=gdp_desc"
```

3. Get specific country:
```bash
curl http://localhost:3000/countries/Nigeria
```

4. Delete country:
```bash
curl -X DELETE http://localhost:3000/countries/Nigeria
```

5. Get status:
```bash
curl http://localhost:3000/status
```

6. Download summary image:
```bash
curl http://localhost:3000/countries/image --output summary.png
```

### Using Postman

Import the endpoints above into Postman for easier testing.

## Project Structure

```
country-api/
├── server.js          # Main application file
├── package.json       # Dependencies and scripts
├── .env              # Environment configuration
├── .gitignore        # Git ignore rules
├── README.md         # Documentation
└── cache/            # Generated images (auto-created)
    └── summary.png   # Summary visualization
```

## Development

### Running in Development Mode

```bash
npm run dev
```

This uses nodemon for automatic server restarts on file changes.

### Database Reset

To reset the database:

```sql
DROP DATABASE countries_db;
CREATE DATABASE countries_db;
```

Then restart the server to reinitialize tables.

## Troubleshooting

### Port Already in Use

Change the `PORT` in `.env` file:
```env
PORT=3001
```

### Database Connection Failed

Verify MySQL is running:
```bash
mysql -u root -p
```

Check credentials in `.env` file match your MySQL configuration.

### Canvas Installation Issues

On Linux, you may need to install dependencies:
```bash
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

On macOS:
```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

### External API Timeout

The APIs have a 10-second timeout. If they're slow, increase the timeout in `server.js`:
```javascript
{ timeout: 20000 } // 20 seconds
```

## License

ISC

## Author

Your Name

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.