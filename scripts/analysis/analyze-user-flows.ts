#!/usr/bin/env tsx

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

interface UserFlow {
  name: string
  path: string
  components: string[]
  actions: string[]
  forms: FormField[]
  apiCalls: string[]
}

interface FormField {
  name: string
  type: string
  required: boolean
  validation?: string
}

function analyzePageFile(filePath: string): Partial<UserFlow> {
  const content = readFileSync(filePath, 'utf-8')
  const flow: Partial<UserFlow> = {
    components: [],
    actions: [],
    forms: [],
    apiCalls: []
  }

  // Find server actions
  const actionImports = content.match(/from ['"]@\/app\/actions\/([^'"]+)['"]/g) || []
  flow.actions = actionImports.map(imp => imp.match(/actions\/([^'"]+)/)?.[1] || '').filter(Boolean)

  // Find form fields
  const inputMatches = content.matchAll(/<(?:input|textarea|select)[^>]*name=["']([^"']+)["'][^>]*>/gi)
  for (const match of inputMatches) {
    const name = match[1]
    const fullTag = match[0]
    const type = fullTag.match(/type=["']([^"']+)["']/)?.[1] || 'text'
    const required = fullTag.includes('required')
    
    if (flow.forms) {
      flow.forms.push({ name, type, required })
    }
  }

  // Find API calls
  const fetchMatches = content.matchAll(/fetch\(['"]([^'"]+)['"]/g)
  const supabaseMatches = content.matchAll(/supabase\.[^.]+\(['"]([^'"]+)['"]/g)
  
  flow.apiCalls = [
    ...Array.from(fetchMatches).map(m => m[1]),
    ...Array.from(supabaseMatches).map(m => `supabase.${m[1]}`)
  ]

  return flow
}

function scanUserFlows(baseDir: string): UserFlow[] {
  const flows: UserFlow[] = []
  const appDir = join(baseDir, 'src/app/(authenticated)')
  
  function scanDirectory(dir: string, basePath: string = '') {
    const items = readdirSync(dir, { withFileTypes: true })
    
    for (const item of items) {
      if (item.isDirectory()) {
        // Skip special Next.js directories
        if (!item.name.startsWith('_') && !item.name.startsWith('(')) {
          scanDirectory(join(dir, item.name), join(basePath, item.name))
        }
      } else if (item.name === 'page.tsx' || item.name === 'page.ts') {
        const filePath = join(dir, item.name)
        const routePath = basePath || '/'
        const flowData = analyzePageFile(filePath)
        
        flows.push({
          name: routePath.split('/').pop() || 'home',
          path: routePath,
          ...flowData
        } as UserFlow)
      }
    }
  }
  
  scanDirectory(appDir)
  return flows
}

// Analyze validation patterns
function analyzeValidation(flows: UserFlow[]) {
  console.log('\n📋 Form Validation Analysis:\n')
  
  const validationIssues: string[] = []
  
  for (const flow of flows) {
    if (flow.forms.length > 0) {
      console.log(`\n${flow.name} (${flow.path}):`)
      console.log(`  Forms fields: ${flow.forms.length}`)
      
      // Check for common validation issues
      const emailFields = flow.forms.filter(f => f.name.includes('email'))
      const phoneFields = flow.forms.filter(f => f.name.includes('phone') || f.name.includes('mobile'))
      const passwordFields = flow.forms.filter(f => f.type === 'password')
      
      if (emailFields.length > 0) {
        console.log(`  - Email fields: ${emailFields.map(f => f.name).join(', ')}`)
      }
      
      if (phoneFields.length > 0) {
        console.log(`  - Phone fields: ${phoneFields.map(f => f.name).join(', ')}`)
      }
      
      if (passwordFields.length > 0) {
        console.log(`  - Password fields: ${passwordFields.map(f => f.name).join(', ')}`)
      }
      
      // Check for missing required attributes
      const textFields = flow.forms.filter(f => f.type === 'text' && !f.required)
      if (textFields.length > 0) {
        console.log(`  ⚠️  Non-required text fields: ${textFields.map(f => f.name).join(', ')}`)
      }
    }
  }
  
  return validationIssues
}

// Generate flow diagram
function generateFlowDiagram(flows: UserFlow[]) {
  console.log('\n🗺️  User Flow Map:\n')
  
  // Group flows by feature area
  const features: Record<string, UserFlow[]> = {}
  
  for (const flow of flows) {
    const feature = flow.path.split('/')[1] || 'root'
    if (!features[feature]) {
      features[feature] = []
    }
    features[feature].push(flow)
  }
  
  // Print flow diagram
  for (const [feature, featureFlows] of Object.entries(features)) {
    console.log(`\n📁 ${feature.toUpperCase()}`)
    
    for (const flow of featureFlows) {
      console.log(`  └─ ${flow.path}`)
      
      if (flow.actions.length > 0) {
        console.log(`     ├─ Actions: ${flow.actions.join(', ')}`)
      }
      
      if (flow.forms.length > 0) {
        console.log(`     ├─ Form fields: ${flow.forms.map(f => f.name).join(', ')}`)
      }
      
      if (flow.apiCalls.length > 0) {
        console.log(`     └─ API calls: ${flow.apiCalls.join(', ')}`)
      }
    }
  }
}

// Edge case testing scenarios
function generateTestScenarios(flows: UserFlow[]) {
  console.log('\n🧪 Edge Case Test Scenarios:\n')
  
  const scenarios = [
    { field: 'email', tests: ['invalid@', '@invalid.com', 'no-at-sign.com', ''] },
    { field: 'phone', tests: ['123', '+44123', '00000000000', 'abc123'] },
    { field: 'date', tests: ['2025-13-01', '2025-00-01', 'not-a-date'] },
    { field: 'number', tests: ['-1', '0', '999999999', 'NaN'] },
  ]
  
  for (const flow of flows) {
    if (flow.forms.length === 0) continue
    
    console.log(`\n${flow.name} (${flow.path}):`)
    
    for (const scenario of scenarios) {
      const matchingFields = flow.forms.filter(f => 
        f.name.includes(scenario.field) || f.type === scenario.field
      )
      
      if (matchingFields.length > 0) {
        console.log(`  ${scenario.field} fields to test:`)
        for (const field of matchingFields) {
          console.log(`    - ${field.name}: Test with ${scenario.tests.join(', ')}`)
        }
      }
    }
  }
}

// Main execution
console.log('🔍 PHASE 2: DYNAMIC TESTING & USER-FLOW MAPPING\n')

const projectRoot = process.cwd()
const flows = scanUserFlows(projectRoot)

console.log(`📊 Found ${flows.length} user flows\n`)

// List all flows
console.log('📍 Discovered Routes:')
flows.forEach(flow => {
  console.log(`  - ${flow.path} (${flow.actions.length} actions, ${flow.forms.length} form fields)`)
})

// Analyze validation
analyzeValidation(flows)

// Generate flow diagram
generateFlowDiagram(flows)

// Generate test scenarios
generateTestScenarios(flows)

// Coverage analysis
console.log('\n📈 Coverage Analysis:')
const totalFlows = flows.length
const flowsWithForms = flows.filter(f => f.forms.length > 0).length
const flowsWithActions = flows.filter(f => f.actions.length > 0).length
const flowsWithoutTests = flows.filter(f => f.forms.length > 0 && !f.path.includes('test')).length

console.log(`  Total flows: ${totalFlows}`)
console.log(`  Flows with forms: ${flowsWithForms}`)
console.log(`  Flows with actions: ${flowsWithActions}`)
console.log(`  Flows needing tests: ${flowsWithoutTests}`)

console.log('\n✅ User flow analysis complete!')