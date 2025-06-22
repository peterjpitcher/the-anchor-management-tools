# Adding Your Logo for Contract Generation

To add your company logo to the private booking contracts:

1. **Logo File Requirements:**
   - File name: `logo.png` (or update the path in `/src/app/api/private-bookings/contract/route.ts`)
   - Recommended dimensions: 400px width x 200px height (or similar aspect ratio)
   - File format: PNG with transparent background (preferred) or JPG
   - File size: Keep under 500KB for optimal loading

2. **Where to Place the Logo:**
   - Add your logo file to the `/public` folder
   - The file should be accessible at `/logo.png` when the app is running

3. **To Update Company Details:**
   - Edit `/src/app/api/private-bookings/contract/route.ts`
   - Find the `companyDetails` object and update:
     - `registrationNumber`: Your company registration number
     - `vatNumber`: Your VAT number (if applicable)
     - `address`: Your full business address
     - `phone`: Your business phone number
     - `email`: Your business email

4. **Alternative Logo Locations:**
   - If you want to use a different path or filename, update the `logoUrl` in the same file
   - You can also use an external URL if your logo is hosted elsewhere

Example:
```javascript
logoUrl: '/images/anchor-logo.png', // Local file
// or
logoUrl: 'https://example.com/logo.png', // External URL
```

The logo will appear at the top of all generated contracts.