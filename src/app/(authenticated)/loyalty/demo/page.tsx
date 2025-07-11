export default function LoyaltyDemoPage() {
  const demoPhoneNumbers = [
    { name: 'Sarah (Silver)', phone: '07700900001', tier: 'silver', points: 1850 },
    { name: 'Mike (Bronze)', phone: '07700900002', tier: 'bronze', points: 650 },
    { name: 'Emma (Gold)', phone: '07700900003', tier: 'gold', points: 2700 },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Loyalty System Demo</h1>
        <p className="text-gray-600">
          This is a demonstration of The Anchor VIPs loyalty system. All data is mocked for testing purposes.
        </p>
      </div>

      {/* Customer Journey */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">🎯 Customer Journey</h2>
        
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 mb-2">1. Customer Self Check-In</h3>
            <p className="text-sm text-gray-600 mb-3">
              Customers scan the event QR code and enter their phone number to check in
            </p>
            <div className="flex gap-3">
              <a
                href="/checkin?event=event-123"
                target="_blank"
                className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                Try Check-In
              </a>
              <a
                href="/loyalty/event-qr"
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                View Event QR Code
              </a>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-medium text-gray-900 mb-2">2. Customer Loyalty Dashboard</h3>
            <p className="text-sm text-gray-600 mb-3">
              After check-in, customers can view their points, achievements, and redeem rewards
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {demoPhoneNumbers.map(demo => (
                <a
                  key={demo.phone}
                  href={`/loyalty?phone=${demo.phone}`}
                  target="_blank"
                  className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="font-medium text-gray-900">{demo.name}</div>
                  <div className="text-sm text-gray-600">Phone: {demo.phone}</div>
                  <div className="text-xs text-amber-600 mt-1">{demo.points} points available</div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Staff Tools */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">👥 Staff Tools</h2>
        
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Redemption Terminal</h3>
            <p className="text-sm text-gray-600 mb-3">
              Staff enter customer redemption codes to validate rewards
            </p>
            <a
              href="/staff/redeem"
              target="_blank"
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Open Redemption Terminal
            </a>
            <p className="text-xs text-gray-500 mt-2">
              Test codes: Generate from customer dashboard first
            </p>
          </div>
        </div>
      </div>

      {/* Demo Flow */}
      <div className="bg-blue-50 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">📋 Demo Flow</h2>
        
        <ol className="space-y-3 text-sm">
          <li className="flex items-start">
            <span className="font-medium text-blue-700 mr-2">1.</span>
            <div>
              <strong>Check In:</strong> Click "Try Check-In" and use one of these phone numbers:
              <ul className="mt-1 ml-4 text-gray-600">
                <li>• 07700900001 (Sarah - existing Silver member)</li>
                <li>• 07700900002 (Mike - existing Bronze member)</li>
                <li>• 07700900099 (Any other - new member)</li>
              </ul>
            </div>
          </li>
          
          <li className="flex items-start">
            <span className="font-medium text-blue-700 mr-2">2.</span>
            <div>
              <strong>View Dashboard:</strong> After check-in, click "View My VIP Status" or use the dashboard links above
            </div>
          </li>
          
          <li className="flex items-start">
            <span className="font-medium text-blue-700 mr-2">3.</span>
            <div>
              <strong>Redeem Reward:</strong> 
              <ul className="mt-1 ml-4 text-gray-600">
                <li>• Go to Rewards tab in customer dashboard</li>
                <li>• Click "Redeem" on any available reward</li>
                <li>• Note the code (expires in 5 minutes)</li>
              </ul>
            </div>
          </li>
          
          <li className="flex items-start">
            <span className="font-medium text-blue-700 mr-2">4.</span>
            <div>
              <strong>Staff Validation:</strong> Open redemption terminal and enter the code to validate
            </div>
          </li>
        </ol>
      </div>

      {/* Technical Notes */}
      <div className="mt-6 text-sm text-gray-600">
        <p className="font-medium mb-2">Technical Notes:</p>
        <ul className="space-y-1">
          <li>• All data is mocked - no database changes are made</li>
          <li>• Check-ins and redemptions are stored in memory only</li>
          <li>• One QR code per event (not per table)</li>
          <li>• System identifies customers by their phone number from booking</li>
          <li>• Timer-based features (5-minute codes) work in real-time</li>
        </ul>
      </div>
    </div>
  );
}