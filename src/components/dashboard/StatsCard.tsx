'use client'

import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'

interface StatsCardProps {
  title: string
  value: string | number
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  iconColor?: string
  trend?: {
    value: number
    label: string
  }
  link?: {
    href: string
    label: string
  }
  subtitle?: string
  loading?: boolean
}

export function StatsCard({ 
  title, 
  value, 
  icon: Icon, 
  iconColor = 'text-gray-600',
  trend,
  link,
  subtitle,
  loading = false
}: StatsCardProps) {
  if (loading) {
    return (
      <div className="bg-white overflow-hidden shadow rounded-lg">
        <div className="p-5">
          <div className="animate-pulse">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-6 w-6 bg-gray-200 rounded"></div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-6 bg-gray-200 rounded w-3/4"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Icon className={`h-6 w-6 ${iconColor}`} />
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">
                {title}
              </dt>
              <dd>
                <div className="flex items-baseline">
                  <div className="text-2xl font-semibold text-gray-900">
                    {value}
                    {subtitle && (
                      <span className="ml-1 text-sm text-gray-500 font-normal">
                        {subtitle}
                      </span>
                    )}
                  </div>
                  
                  {trend && (
                    <div className={`ml-2 flex items-baseline text-sm font-semibold ${
                      trend.value > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {trend.value > 0 ? (
                        <ArrowUpIcon className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <ArrowDownIcon className="h-4 w-4 flex-shrink-0" />
                      )}
                      <span className="sr-only">
                        {trend.value > 0 ? 'Increased' : 'Decreased'} by
                      </span>
                      {Math.abs(trend.value)}%
                      <span className="text-gray-500 font-normal ml-1">
                        {trend.label}
                      </span>
                    </div>
                  )}
                  
                  {link && (
                    <Link
                      href={link.href}
                      className="ml-auto text-sm text-indigo-600 hover:text-indigo-500"
                    >
                      {link.label}
                    </Link>
                  )}
                </div>
              </dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}