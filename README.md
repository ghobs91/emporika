# Emporika - Intelligent Shopping Search Engine

An intelligent shopping search engine that allows users to browse and search across multiple online retailers. Currently integrated with Walmart's Product Search API and Best Buy's Product Search API.

## Features

- 🔍 **Smart Search**: Search for products across retailers with intelligent query processing
- 🛍️ **Product Display**: Beautiful product cards with images, prices, ratings, and discounts
- 💰 **Price Comparison**: See discounts, original prices, and current sale prices
- ⭐ **Customer Ratings**: View product ratings and review counts
- 📱 **Responsive Design**: Fully responsive UI that works on all devices
- 🚀 **Fast Performance**: Built with Next.js 14+ and React Server Components
- 🏪 **Multi-Retailer Search**: Search products from Walmart and Best Buy simultaneously

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **API Integration**: Walmart Product Search API, Best Buy Product Search API

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Walmart API credentials from [https://developer.walmart.com/](https://developer.walmart.com/)
  - Consumer ID (Client ID)
  - Private Key (for signing requests)
  - Key Version (usually "1")
- Best Buy API credentials from [https://developer.bestbuy.com/](https://developer.bestbuy.com/)
  - API Key

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd emporika
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   
   Create a `.env.local` file in the root directory and add your API credentials:
   ```env
   # Walmart API credentials
   WALMART_CONSUMER_ID=your_consumer_id_here
   WALMART_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----"
   WALMART_KEY_VERSION=1
   
   # Best Buy API credentials
   BESTBUY_API_KEY=your_bestbuy_api_key_here
   ```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
emporika/
├── app/
│   ├── api/
│   │   ├── search/
│   │   │   └── route.ts          # Unified search API endpoint
│   │   └── trending/
│   │       └── route.ts          # Trending products API endpoint
│   ├── globals.css               # Global styles
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Home page
├── components/
│   ├── ProductCard.tsx           # Product card component
│   ├── ProductGrid.tsx           # Product grid layout
│   ├── SearchBar.tsx             # Search input component
│   └── TrendingFeed.tsx          # Trending products component
├── lib/
│   ├── walmart.ts                # Walmart API client
│   └── bestbuy.ts                # Best Buy API client
├── types/
│   ├── walmart.ts                # TypeScript types for Walmart API
│   ├── bestbuy.ts                # TypeScript types for Best Buy API
│   └── unified.ts                # Unified product types for cross-retailer display
└── .env.local                    # Environment variables
```

## API Integration

### Walmart Search API

The application integrates with Walmart's Affiliate API v1 Search endpoint:

**Endpoint**: `https://api.walmartlabs.com/v1/search`

**Parameters**:
- `query`: Search term
- `sort`: Sort order (relevance, price, title, bestseller, customerRating, new)
- `order`: Ascending or descending
- `numItems`: Number of items to return (default: 25)
- `start`: Pagination offset

### Best Buy Search API

The application integrates with Best Buy's Products API:

**Endpoint**: `https://api.bestbuy.com/v1/products((search={query}))`

**Parameters**:
- `apiKey`: Your Best Buy API key
- `format`: Response format (json)
- `pageSize`: Number of items to return
- `page`: Page number for pagination
- `show`: Fields to include in the response

### Adding More Retailers

To add more retailers:

1. Create a new API client in `lib/` (e.g., `lib/amazon.ts`)
2. Define TypeScript types in `types/` (e.g., `types/amazon.ts`)
3. Add normalization function to `types/unified.ts`
4. Update the search logic in `app/api/search/route.ts` to include the new source

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `WALMART_CONSUMER_ID` | Your Consumer ID (Client ID) from developer.walmart.com | Yes |
| `WALMART_PRIVATE_KEY` | Your private key for signing API requests | Yes |
| `WALMART_KEY_VERSION` | Private key version (usually "1") | Yes |
| `BESTBUY_API_KEY` | Your API key from developer.bestbuy.com | Yes |

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## Features Roadmap

- [x] Add Best Buy as a retailer
- [ ] Add more retailers (Amazon, Target, etc.)
- [ ] Advanced filtering (price range, ratings, categories)
- [ ] Sort options (price, rating, relevance)
- [ ] Pagination for results
- [ ] Product comparison feature
- [ ] Price history tracking
- [ ] User accounts and saved searches
- [ ] Price alerts and notifications

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Walmart Open API](https://walmart.io/) for product data
- [Next.js](https://nextjs.org/) for the amazing framework
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Lucide React](https://lucide.dev/) for icons
