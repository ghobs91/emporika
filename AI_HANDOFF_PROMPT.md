# Handoff Prompt: Redesign Emporika Home UI with shop.app-Inspired Patterns

## Project context

Emporika is a Next.js 15 + Tailwind CSS app that aggregates products from Walmart, Best Buy, Target, eBay, Costco, and Shopify. The app already supports light/dark mode, AI-powered natural-language search, and a cart grouped by merchant.

## Goal

Redesign the home page experience to borrow six specific patterns from shop.app. Keep changes focused on `app/page.tsx`, existing components, and global styles. Do **not** change API route behavior or add new backend dependencies unless absolutely necessary.

## Reference points

Key files you will touch:

- `emporika/app/page.tsx` — main home page
- `emporika/components/SearchBar.tsx` — current search input
- `emporika/components/TrendingFeed.tsx` — category sections with product grids
- `emporika/components/ProductCard.tsx` — product card used everywhere
- `emporika/components/ProductGrid.tsx` — search result grid
- `emporika/components/CartDrawer.tsx` and `emporika/components/CartIcon.tsx`
- `emporika/context/CartContext.tsx` — cart state and `itemsByMerchant`
- `emporika/types/categories.ts` — `getAllCategories()` and `ProductCategory`
- `emporika/app/globals.css` — global styling
- `emporika/app/layout.tsx` — root layout

## The six changes

### 1. Centered “command” hero search on the empty state

- When no search has been performed (`!searchQuery && !isLoading && !aiState.isLoading`), render a vertically centered hero section.
- Place the headline “What are you shopping for today?” above a large, centered search bar.
- Keep the existing `SearchBar` component but allow an optional `size="large"` prop (or wrapper) that increases padding, font size, and border radius.
- Move the existing example prompts from small chips under the headline to a clean, centered row of chip buttons directly beneath the search bar.
- Reference the shop.app screenshot: search should feel like the primary action, not a header input.

### 2. Horizontal category pill rail

- Render a horizontally scrollable row of category pills between the search bar and the main content.
- Use `getAllCategories().filter(cat => cat.id !== 'all')` as the data source.
- Each pill should show an icon + category name and have a subtle colored circular background (similar to shop.app’s Women/Men/Beauty/Home pills).
- Clicking a pill should call `handleSearch(cat.name)` to trigger a search for that category.
- On mobile, this rail should hide its scrollbar but remain swipeable.

### 3. “Deals for you” horizontal carousel

- Add a new section on the home page (visible both with and without an active search, or at least on the empty state) called “Deals for you”.
- Pull items from the existing `/api/trending` response or filter the current `products`/`sortedProducts` for items with a meaningful discount (`originalPrice > price`).
- Render as a horizontal scrollable carousel of large cards (wider than the regular grid cards).
- Each card must show: product image, “Save $X” badge, retailer logo, rating + review count, and current price.
- Use the existing `ProductCard` as a base if possible, but create a new `DealCard` component if the layout diverges too much.
- Add left/right scroll affordances on desktop; swipe on mobile.

### 4. Merchant-level cart summary cards on the home page

- When the cart is not empty, render a compact “In your cart” section on the home page (below the hero / category rail, before the trending feed).
- Use `itemsByMerchant` from `CartContext` to group items.
- Each card should show: merchant logo/favicon placeholder, merchant name, estimated subtotal, and a “Continue to checkout” button.
- Clicking the button should reuse the existing combined-checkout logic from `CartDrawer.handleCheckoutAll` (extract it into a shared hook or utility if needed).
- Do not list every item inside the card; keep it merchant-level, matching shop.app.

### 5. Left icon sidebar on desktop

- Add a persistent left icon rail on desktop breakpoints (`lg:` and up) containing: Home, Categories, Cart, Favorites/Wishlist (placeholder), and Account/Settings (placeholder).
- Use Lucide icons. The active state should highlight the current page.
- Remove the cart icon from the top header on desktop and rely on the sidebar + badge count.
- Keep the mobile header layout roughly as-is, but consider collapsing the two-row mobile header into one cleaner row.
- Ensure the main content area is offset by the sidebar width on desktop.

### 6. Tighten visual language

- Increase border radius across cards and sections to `rounded-3xl` where appropriate.
- In dark mode, use slightly darker card backgrounds (`#1a1a1a` page, `#242424` cards) and more generous padding.
- Make product images larger relative to text; reduce visual clutter on product cards.
- Update `ProductCard` to emphasize the retailer/brand logo and rating more prominently.
- Keep the existing light-mode theme working; do not force dark mode.

## Constraints

- Do not add new npm packages unless required for the carousel or sidebar behavior. Prefer existing dependencies.
- Reuse existing data fetching; do not create new API routes.
- Maintain existing accessibility (keyboard navigation, focus states, aria labels).
- Preserve current AI search and filter behavior; only change layout/styling.
- Keep the PWA install prompt and footer intact.

## Acceptance criteria

- [ ] Empty-state home page shows a centered hero search with category pills underneath.
- [ ] A “Deals for you” horizontal carousel appears and displays discounted products correctly.
- [ ] When cart has items, merchant-level “In your cart” cards appear on the home page.
- [ ] Desktop shows a left icon sidebar and a cleaner top header.
- [ ] Product cards look more image-forward with prominent badges/logos/ratings.
- [ ] Light and dark themes both look polished.
- [ ] `npm run build` succeeds without errors.
- [ ] No existing core functionality (search, filters, checkout) is broken.

## Output

Make the changes, run the build, and summarize which files were modified and any tradeoffs you made. Include before/after notes if the layout changed significantly on mobile.
