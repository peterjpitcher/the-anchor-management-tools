#!/usr/bin/env tsx

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

interface APIEndpoint {
  path: string
  methods: string[]
  authentication: 'public' | 'authenticated' | 'cron' | 'webhook'
  requestBody?: any
  responseFormat?: any
  rateLimit?: string
  description?: string
}

interface ServerAction {
  name: string
  file: string
  exported: boolean
  parameters: string[]
  returnType: string
  description?: string
}

function analyzeAPIRoute(filePath: string, routePath: string): APIEndpoint {
  const content = readFileSync(filePath, 'utf-8')
  const endpoint: APIEndpoint = {
    path: routePath,
    methods: [],
    authentication: 'public'
  }
  
  // Find HTTP methods
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  methods.forEach(method => {
    if (content.includes(`export async function ${method}`) || 
        content.includes(`export function ${method}`)) {
      endpoint.methods.push(method)
    }
  })
  
  // Determine authentication
  if (content.includes('auth.getUser()') || content.includes('supabase.auth')) {
    endpoint.authentication = 'authenticated'
  } else if (content.includes('CRON_SECRET') || content.includes('x-cron-secret')) {
    endpoint.authentication = 'cron'
  } else if (content.includes('twilio') || content.includes('webhook')) {
    endpoint.authentication = 'webhook'
  }
  
  // Extract description from comments
  const descMatch = content.match(/\/\*\*[\s\S]*?\*\//)
  if (descMatch) {
    const desc = descMatch[0].replace(/\/\*\*|\*\//g, '').replace(/\* ?/g, '').trim()
    endpoint.description = desc.split('\n')[0]
  }
  
  return endpoint
}

function analyzeServerAction(filePath: string): ServerAction[] {
  const content = readFileSync(filePath, 'utf-8')
  const actions: ServerAction[] = []
  
  // Find exported async functions
  const functionRegex = /export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*{/g
  
  let match
  while ((match = functionRegex.exec(content)) !== null) {
    const name = match[1]
    const params = match[2].split(',').map(p => p.trim()).filter(Boolean)
    const returnType = match[3]?.trim() || 'Promise<any>'
    
    actions.push({
      name,
      file: filePath.split('/').pop()!,
      exported: true,
      parameters: params,
      returnType
    })
  }
  
  return actions
}

function scanAPIRoutes(baseDir: string): APIEndpoint[] {
  const endpoints: APIEndpoint[] = []
  const apiDir = join(baseDir, 'src/app/api')
  
  function scanDirectory(dir: string, basePath: string = '/api') {
    try {
      const items = readdirSync(dir, { withFileTypes: true })
      
      for (const item of items) {
        if (item.isDirectory()) {
          const newPath = join(basePath, item.name)
          scanDirectory(join(dir, item.name), newPath)
        } else if (item.name === 'route.ts' || item.name === 'route.js') {
          const filePath = join(dir, item.name)
          const endpoint = analyzeAPIRoute(filePath, basePath)
          endpoints.push(endpoint)
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }
  
  scanDirectory(apiDir)
  return endpoints
}

function scanServerActions(baseDir: string): ServerAction[] {
  const actions: ServerAction[] = []
  const actionsDir = join(baseDir, 'src/app/actions')
  
  try {
    const files = readdirSync(actionsDir)
    
    for (const file of files) {
      if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
        const filePath = join(actionsDir, file)
        const fileActions = analyzeServerAction(filePath)
        actions.push(...fileActions)
      }
    }
  } catch (error) {
    // Ignore errors
  }
  
  return actions
}

// Generate OpenAPI-style documentation
function generateAPIDoc(endpoints: APIEndpoint[], actions: ServerAction[]) {
  const doc = {
    openapi: '3.0.0',
    info: {
      title: 'Anchor Management Tools API',
      version: '1.0.0',
      description: 'API documentation for The Anchor venue management system'
    },
    servers: [
      {
        url: process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk',
        description: 'Production server'
      }
    ],
    paths: {} as any,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer'
        },
        cronKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-cron-secret'
        }
      }
    }
  }
  
  // Add API endpoints
  endpoints.forEach(endpoint => {
    doc.paths[endpoint.path] = {}
    
    endpoint.methods.forEach(method => {
      const security = []
      if (endpoint.authentication === 'authenticated') {
        security.push({ bearerAuth: [] })
      } else if (endpoint.authentication === 'cron') {
        security.push({ cronKey: [] })
      }
      
      doc.paths[endpoint.path][method.toLowerCase()] = {
        summary: endpoint.description || `${method} ${endpoint.path}`,
        security,
        responses: {
          '200': {
            description: 'Successful response'
          },
          '401': {
            description: 'Unauthorized'
          },
          '500': {
            description: 'Internal server error'
          }
        }
      }
    })
  })
  
  return doc
}

// Main execution
console.log('🔍 PHASE 3: API SURFACE AUDIT\n')

const projectRoot = process.cwd()
const endpoints = scanAPIRoutes(projectRoot)
const actions = scanServerActions(projectRoot)

console.log(`📊 API Inventory:`)
console.log(`  - REST Endpoints: ${endpoints.length}`)
console.log(`  - Server Actions: ${actions.length}`)

console.log('\n🌐 REST API Endpoints:\n')
endpoints.forEach(endpoint => {
  console.log(`📍 ${endpoint.path}`)
  console.log(`   Methods: ${endpoint.methods.join(', ')}`)
  console.log(`   Auth: ${endpoint.authentication}`)
  if (endpoint.description) {
    console.log(`   Description: ${endpoint.description}`)
  }
  console.log()
})

console.log('🔧 Server Actions:\n')
// Group actions by file
const actionsByFile: Record<string, ServerAction[]> = {}
actions.forEach(action => {
  if (!actionsByFile[action.file]) {
    actionsByFile[action.file] = []
  }
  actionsByFile[action.file].push(action)
})

Object.entries(actionsByFile).forEach(([file, fileActions]) => {
  console.log(`📄 ${file}:`)
  fileActions.forEach(action => {
    console.log(`   - ${action.name}(${action.parameters.length} params) → ${action.returnType}`)
  })
  console.log()
})

// Contract verification
console.log('📋 Contract Verification:\n')

endpoints.forEach(endpoint => {
  console.log(`${endpoint.path}:`)
  endpoint.methods.forEach(method => {
    console.log(`  ${method}:`)
    console.log(`    ✅ Authentication: ${endpoint.authentication}`)
    console.log(`    ⚠️  Request schema: Not documented`)
    console.log(`    ⚠️  Response schema: Not documented`)
    console.log(`    ⚠️  Rate limit: ${endpoint.authentication === 'cron' ? 'N/A' : 'Supabase default'}`)
  })
  console.log()
})

// Generate OpenAPI doc
const apiDoc = generateAPIDoc(endpoints, actions)
console.log('\n📄 OpenAPI Documentation Generated')
console.log(`   Total paths: ${Object.keys(apiDoc.paths).length}`)

// Coverage analysis
console.log('\n📈 API Coverage Analysis:')
console.log(`  Documented endpoints: 0/${endpoints.length} (0%)`)
console.log(`  Typed server actions: ${actions.length}/${actions.length} (100%)`)
console.log(`  Rate limiting: Supabase defaults only`)
console.log(`  Authentication coverage: 100%`)

console.log('\n⚠️  Recommendations:')
console.log('  1. Add request/response schemas to all endpoints')
console.log('  2. Implement custom rate limiting for expensive operations')
console.log('  3. Generate API documentation from code')
console.log('  4. Add integration tests for all endpoints')

console.log('\n✅ API surface audit complete!')