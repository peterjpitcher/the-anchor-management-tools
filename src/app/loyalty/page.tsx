'use client';

import Link from 'next/link';
import { 
  SparklesIcon,
  GiftIcon,
  ChartBarIcon,
  StarIcon,
  CheckCircleIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';
import VIPClubLogo from '@/components/loyalty/VIPClubLogo';

const tiers = [
  {
    name: 'Bronze',
    icon: '🥉',
    color: '#CD7F32',
    minEvents: 0,
    multiplier: 1,
    benefits: [
      'Earn 10 points per event',
      'Access to basic rewards',
      'Birthday surprise'
    ]
  },
  {
    name: 'Silver',
    icon: '🥈',
    color: '#C0C0C0',
    minEvents: 5,
    multiplier: 1.5,
    benefits: [
      'Earn 15 points per event',
      'Early access to events',
      'Exclusive silver rewards',
      'Monthly bonus offers'
    ]
  },
  {
    name: 'Gold',
    icon: '🥇',
    color: '#FFD700',
    minEvents: 15,
    multiplier: 2,
    benefits: [
      'Earn 20 points per event',
      'Priority booking',
      'Premium gold rewards',
      'Complimentary birthday meal',
      'VIP table service'
    ]
  },
  {
    name: 'Platinum',
    icon: '💎',
    color: '#E5E4E2',
    minEvents: 30,
    multiplier: 3,
    benefits: [
      'Earn 30 points per event',
      'Exclusive platinum events',
      'All premium rewards',
      'Personal event concierge',
      'Private venue discounts',
      '50% birthday discount'
    ]
  }
];

const popularRewards = [
  { name: 'Free Coffee', points: 100, icon: '☕' },
  { name: 'Free Pint', points: 200, icon: '🍺' },
  { name: '10% Off Food', points: 300, icon: '🍽️' },
  { name: 'Priority Booking', points: 500, icon: '⚡' }
];

export default function LoyaltyLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-600/10 to-orange-600/10" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center">
            <div className="mb-8">
              <VIPClubLogo size="large" />
            </div>
            <h1 className="text-5xl font-bold text-gray-900 mb-6">
              Join the Anchor VIP Club
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Earn points, unlock exclusive rewards, and enjoy VIP treatment at every visit. 
              The more you visit, the more you save!
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/loyalty/portal/login"
                className="inline-flex items-center px-8 py-4 bg-amber-600 text-white rounded-lg font-semibold text-lg hover:bg-amber-700 transition-colors"
              >
                Member Login
                <ArrowRightIcon className="ml-2 h-5 w-5" />
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center px-8 py-4 bg-white text-amber-600 rounded-lg font-semibold text-lg hover:bg-gray-50 transition-colors border-2 border-amber-600"
              >
                Learn More
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div id="how-it-works" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            How It Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-amber-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                <StarIcon className="h-10 w-10 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold mb-2">1. Join Free</h3>
              <p className="text-gray-600">
                Sign up at your next visit or event booking and start earning immediately
              </p>
            </div>
            <div className="text-center">
              <div className="bg-amber-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                <ChartBarIcon className="h-10 w-10 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold mb-2">2. Earn Points</h3>
              <p className="text-gray-600">
                Get points for every event you attend. Higher tiers earn bonus multipliers!
              </p>
            </div>
            <div className="text-center">
              <div className="bg-amber-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                <GiftIcon className="h-10 w-10 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold mb-2">3. Redeem Rewards</h3>
              <p className="text-gray-600">
                Exchange your points for free drinks, food discounts, and exclusive perks
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Membership Tiers */}
      <div className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Membership Tiers
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow"
                style={{ borderTop: `4px solid ${tier.color}` }}
              >
                <div className="text-center mb-4">
                  <span className="text-4xl">{tier.icon}</span>
                  <h3 className="text-2xl font-bold mt-2" style={{ color: tier.color }}>
                    {tier.name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {tier.minEvents === 0 ? 'Start here!' : `${tier.minEvents}+ events`}
                  </p>
                </div>
                <div className="text-center mb-4">
                  <p className="text-3xl font-bold text-gray-900">
                    {tier.multiplier}x
                  </p>
                  <p className="text-sm text-gray-600">points multiplier</p>
                </div>
                <ul className="space-y-2">
                  {tier.benefits.map((benefit, index) => (
                    <li key={index} className="flex items-start text-sm">
                      <CheckCircleIcon className="h-5 w-5 text-green-500 mr-2 flex-shrink-0" />
                      <span className="text-gray-700">{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Popular Rewards */}
      <div className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Popular Rewards
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {popularRewards.map((reward) => (
              <div key={reward.name} className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-6 text-center">
                <span className="text-4xl mb-4 block">{reward.icon}</span>
                <h3 className="font-semibold text-gray-900 mb-2">{reward.name}</h3>
                <p className="text-2xl font-bold text-amber-600">{reward.points}</p>
                <p className="text-sm text-gray-600">points</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <p className="text-gray-600">
              And many more rewards waiting for you!
            </p>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="py-16 bg-gradient-to-r from-amber-600 to-orange-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to Start Earning?
          </h2>
          <p className="text-xl text-amber-100 mb-8">
            Join thousands of members enjoying exclusive benefits
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/loyalty/portal/login"
              className="inline-flex items-center px-8 py-4 bg-white text-amber-600 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-colors"
            >
              Member Portal
              <ArrowRightIcon className="ml-2 h-5 w-5" />
            </Link>
            <a
              href="tel:01753682707"
              className="inline-flex items-center px-8 py-4 bg-amber-700 text-white rounded-lg font-semibold text-lg hover:bg-amber-800 transition-colors"
            >
              Call Us to Join
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="py-8 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center text-gray-400">
            <p>© 2024 The Anchor. All rights reserved.</p>
            <p className="mt-2">
              <Link href="/privacy" className="hover:text-white">Privacy Policy</Link>
              {' • '}
              <Link href="/terms" className="hover:text-white">Terms & Conditions</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}