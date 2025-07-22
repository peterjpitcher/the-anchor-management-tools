'use client';

import { useState } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { 
  AcademicCapIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  PlayIcon,
  ChevronRightIcon,
  UserGroupIcon,
  QrCodeIcon,
  GiftIcon,
  PhoneIcon
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import Image from 'next/image';

interface TrainingModule {
  id: string;
  title: string;
  message: string;
  duration: string;
  icon: any;
  steps: string[];
  tips: string[];
}

const trainingModules: TrainingModule[] = [
  { id: 'enrollment',
    title: 'Enrolling New Members',
    message: 'Learn how to enroll customers in The Anchor VIP Club',
    duration: '5 minutes',
    icon: UserGroupIcon,
    steps: [
      'Navigate to the Customers page from the main menu',
      'Find the customer you want to enroll (use search if needed)',
      'Click the "Enroll" button next to their name in the VIP Status column',
      'The customer will receive a welcome SMS with their bonus points',
      'Their VIP status will update immediately showing their tier and points'
    ],
    tips: [
      'Make sure the customer has a valid mobile number before enrolling',
      'Explain the benefits of joining - 50 bonus points immediately!',
      'Show them how they can check in at events to earn more points'
    ]
  },
  { id: 'checkin',
    title: 'Event Check-ins',
    message: 'Help customers check in at events to earn points',
    duration: '3 minutes',
    icon: QrCodeIcon,
    steps: [
      'Display the event QR code at the entrance or on tables',
      'Customers scan the QR code with their phone camera',
      'They enter their mobile number on the check-in page',
      'Points are awarded automatically based on the event type',
      'They receive an SMS confirmation with their new balance'
    ],
    tips: [
      'Have the QR code printed and displayed prominently',
      'Help customers who are unfamiliar with QR codes',
      'Mention they can check in even without a booking',
      'First-time users can sign up directly from the check-in page'
    ]
  },
  { id: 'redemption',
    title: 'Processing Redemptions',
    message: 'Handle reward redemptions for VIP members',
    duration: '4 minutes',
    icon: GiftIcon,
    steps: [
      'Customer shows you their redemption code (7 characters)',
      'Navigate to Loyalty > Redeem from the menu',
      'Enter the redemption code in the field',
      'Click "Validate Code" to verify it',
      'Once validated, provide the reward to the customer',
      'The system marks the code as used automatically'
    ],
    tips: [
      'Codes are case-insensitive - ABC123X works the same as abc123x',
      'Codes expire after 24 hours - check the expiry time',
      'Each code can only be used once',
      'If a code is invalid, double-check the customer entered it correctly'
    ]
  },
  { id: 'support',
    title: 'Customer Support',
    message: 'Common questions and how to help VIP members',
    duration: '6 minutes',
    icon: PhoneIcon,
    steps: [
      'To check a customer\'s VIP status, search for them in Customers',
      'Click on their name to see full loyalty details',
      'You can view their tier, points balance, and recent activity',
      'For missing points, check if they checked in at the event',
      'For technical issues, note their phone number and contact management'
    ],
    tips: [
      'Most issues are resolved by checking if they checked in properly',
      'Remind customers that points are earned at check-in, not booking',
      'SMS must be enabled to receive notifications',
      'Encourage customers to save their redemption codes immediately'
    ]
  }
];

export default function StaffTrainingPage() {
  const { hasPermission } = usePermissions();
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [completedModules, setCompletedModules] = useState<string[]>([]);

  const markAsComplete = (moduleId: string) => {
    if (!completedModules.includes(moduleId)) {
      setCompletedModules([...completedModules, moduleId]);
    }
  };

  const selectedModule = trainingModules.find(m => m.id === activeModule);
  const completionRate = Math.round((completedModules.length / trainingModules.length) * 100);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <AcademicCapIcon className="h-8 w-8 mr-3 text-amber-600" />
              Staff Training: VIP Club
            </h1>
            <p className="mt-2 text-gray-600">
              Learn how to help customers with The Anchor VIP Club loyalty program
            </p>
          </div>
          <Link
            href="/loyalty/admin"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Back to Loyalty
          </Link>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-8 bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-medium text-gray-900">Your Progress</h2>
          <span className="text-sm font-medium text-gray-500">
            {completedModules.length} of {trainingModules.length} modules completed
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div 
            className="bg-amber-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${completionRate}%` }}
          />
        </div>
        {completionRate === 100 && (
          <div className="mt-4 flex items-center text-green-600">
            <CheckCircleIcon className="h-5 w-5 mr-2" />
            <span className="font-medium">Congratulations! You&apos;ve completed all training modules.</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Module List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b">
              <h3 className="text-lg font-medium text-gray-900">Training Modules</h3>
            </div>
            <ul className="divide-y divide-gray-200">
              {trainingModules.map(module => (
                <li key={module.id}>
                  <button
                    onClick={() => setActiveModule(module.id)}
                    className={`w-full px-4 py-4 hover:bg-gray-50 flex items-center justify-between transition-colors ${
                      activeModule === module.id ? 'bg-amber-50' : ''
                    }`}
                  >
                    <div className="flex items-center">
                      <div className={`flex-shrink-0 ${
                        completedModules.includes(module.id) ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {completedModules.includes(module.id) ? (
                          <CheckCircleIcon className="h-6 w-6" />
                        ) : (
                          <module.icon className="h-6 w-6" />
                        )}
                      </div>
                      <div className="ml-3 text-left">
                        <p className="text-sm font-medium text-gray-900">{module.title}</p>
                        <p className="text-xs text-gray-500">{module.duration}</p>
                      </div>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Module Content */}
        <div className="lg:col-span-2">
          {selectedModule ? (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 bg-amber-50 border-b">
                <div className="flex items-center">
                  <selectedModule.icon className="h-8 w-8 text-amber-600 mr-3" />
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">{selectedModule.title}</h2>
                    <p className="text-sm text-gray-600">{selectedModule.message}</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Steps */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Step-by-Step Guide</h3>
                  <ol className="space-y-3">
                    {selectedModule.steps.map((step, index) => (
                      <li key={index} className="flex">
                        <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-amber-100 text-amber-600 font-medium text-sm">
                          {index + 1}
                        </span>
                        <span className="ml-3 text-gray-700">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Tips */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Pro Tips</h3>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <ul className="space-y-2">
                      {selectedModule.tips.map((tip, index) => (
                        <li key={index} className="flex items-start">
                          <InformationCircleIcon className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
                          <span className="text-sm text-blue-800">{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Visual Aid */}
                {selectedModule.id === 'checkin' && (
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Visual Example</h3>
                    <div className="bg-gray-50 rounded-lg p-6 text-center">
                      <Image
                        src="/VIPs.png"
                        alt="VIP Club Logo"
                        width={120}
                        height={120}
                        className="mx-auto mb-4"
                      />
                      <p className="text-sm text-gray-600">
                        This is the VIP Club logo customers will see when checking in
                      </p>
                    </div>
                  </div>
                )}

                {/* Mark Complete Button */}
                <div className="pt-4 border-t">
                  {completedModules.includes(selectedModule.id) ? (
                    <div className="flex items-center text-green-600">
                      <CheckCircleIcon className="h-5 w-5 mr-2" />
                      <span className="font-medium">Module completed</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => markAsComplete(selectedModule.id)}
                      className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
                    >
                      <CheckCircleIcon className="h-4 w-4 mr-2" />
                      Mark as Complete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <AcademicCapIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Select a Training Module
              </h3>
              <p className="text-gray-500">
                Choose a module from the list to begin your training
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Reference Card */}
      <div className="mt-8 bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Reference</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded p-4">
            <h4 className="font-medium text-gray-900 mb-2">Welcome Bonus</h4>
            <p className="text-2xl font-bold text-amber-600">50 points</p>
            <p className="text-sm text-gray-500">For new members</p>
          </div>
          <div className="bg-white rounded p-4">
            <h4 className="font-medium text-gray-900 mb-2">Check-in Points</h4>
            <p className="text-2xl font-bold text-amber-600">50-300</p>
            <p className="text-sm text-gray-500">Based on event type</p>
          </div>
          <div className="bg-white rounded p-4">
            <h4 className="font-medium text-gray-900 mb-2">Code Expiry</h4>
            <p className="text-2xl font-bold text-amber-600">24 hours</p>
            <p className="text-sm text-gray-500">After generation</p>
          </div>
          <div className="bg-white rounded p-4">
            <h4 className="font-medium text-gray-900 mb-2">Support</h4>
            <p className="text-lg font-bold text-amber-600">Ask Manager</p>
            <p className="text-sm text-gray-500">For any issues</p>
          </div>
        </div>
      </div>
    </div>
  );
}