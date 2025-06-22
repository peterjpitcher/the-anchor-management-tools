#!/usr/bin/env tsx

import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from 'dotenv'

config({ path: '.env' })

interface TableColumn {
  name: string
  type: string
  nullable: boolean
  default?: string
}

interface TableSchema {
  [tableName: string]: TableColumn[]
}

// Parse SQL schema file to extract table definitions
function parseSQLSchema(sqlContent: string): TableSchema {
  const schema: TableSchema = {}
  
  // Regular expression to match CREATE TABLE statements
  const tableRegex = /CREATE TABLE IF NOT EXISTS "public"\."(\w+)"\s*\(([\s\S]+?)\);/gi
  
  let match
  while ((match = tableRegex.exec(sqlContent)) !== null) {
    const tableName = match[1]
    const columnsBlock = match[2]
    
    const columns: TableColumn[] = []
    
    // Parse column definitions
    const lines = columnsBlock.split(',\n').map(line => line.trim())
    
    for (const line of lines) {
      // Skip constraints and empty lines
      if (!line || line.includes('CONSTRAINT') || line.includes('PRIMARY KEY') || 
          line.includes('FOREIGN KEY') || line.includes('CHECK') || line.includes('UNIQUE')) {
        continue
      }
      
      // Match column definition: "column_name" type [NOT NULL] [DEFAULT ...]
      const columnMatch = line.match(/^"(\w+)"\s+([^,\s]+(?:\s+COLLATE\s+"[^"]+")?)(?:\s+(.*))?/i)
      
      if (columnMatch) {
        const name = columnMatch[1]
        let type = columnMatch[2].toLowerCase()
        const modifiers = columnMatch[3] || ''
        
        // Clean up type
        type = type.replace(/\s+collate\s+"[^"]+"/i, '')
        
        const nullable = !modifiers.includes('NOT NULL')
        
        columns.push({ name, type, nullable })
      }
    }
    
    if (columns.length > 0) {
      schema[tableName] = columns
    }
  }
  
  return schema
}

// Parse TypeScript type definitions
function parseTypeScriptTypes(tsContent: string): Record<string, Record<string, string>> {
  const types: Record<string, Record<string, string>> = {}
  
  // Match type/interface definitions
  const typeRegex = /(?:export\s+)?(?:type|interface)\s+(\w+)\s*(?:extends\s+\w+\s*)?=?\s*{([^}]+)}/g
  
  let match
  while ((match = typeRegex.exec(tsContent)) !== null) {
    const typeName = match[1]
    const propertiesBlock = match[2]
    
    const properties: Record<string, string> = {}
    
    // Parse properties
    const propRegex = /(\w+)(\?)?\s*:\s*([^;,\n]+)/g
    let propMatch
    
    while ((propMatch = propRegex.exec(propertiesBlock)) !== null) {
      const propName = propMatch[1]
      const isOptional = propMatch[2] === '?'
      const propType = propMatch[3].trim()
      
      properties[propName] = isOptional ? `${propType} | undefined` : propType
    }
    
    types[typeName] = properties
  }
  
  return types
}

// Map SQL types to TypeScript types
function sqlToTsType(sqlType: string): string {
  const typeMap: Record<string, string> = {
    'uuid': 'string',
    'text': 'string',
    'varchar': 'string',
    'character varying': 'string',
    'timestamp': 'string',
    'timestamptz': 'string',
    'timestamp with time zone': 'string',
    'timestamp without time zone': 'string',
    'date': 'string',
    'time': 'string',
    'boolean': 'boolean',
    'bool': 'boolean',
    'integer': 'number',
    'int': 'number',
    'int4': 'number',
    'bigint': 'number',
    'numeric': 'number',
    'decimal': 'number',
    'real': 'number',
    'double precision': 'number',
    'json': 'any',
    'jsonb': 'any',
  }
  
  const baseType = sqlType.replace(/\(\d+\)/, '').toLowerCase()
  return typeMap[baseType] || 'any'
}

// Main analysis function
async function analyzeSchemaConsistency() {
  console.log('🔍 PHASE 1: STATIC ANALYSIS - Schema Consistency Check\n')
  
  try {
    // Read SQL schema
    const sqlPath = join(process.cwd(), 'supabase/dumps/2025-06-21i-schema.sql')
    const sqlContent = readFileSync(sqlPath, 'utf-8')
    const sqlSchema = parseSQLSchema(sqlContent)
    
    console.log(`📊 Found ${Object.keys(sqlSchema).length} tables in SQL schema\n`)
    
    // Read TypeScript types
    const typesPath = join(process.cwd(), 'src/types/database.ts')
    const tsContent = readFileSync(typesPath, 'utf-8')
    const tsTypes = parseTypeScriptTypes(tsContent)
    
    console.log(`📝 Found ${Object.keys(tsTypes).length} TypeScript types\n`)
    
    // Map of SQL table names to TypeScript type names
    const tableTypeMap: Record<string, string> = {
      'events': 'Event',
      'customers': 'Customer',
      'bookings': 'Booking',
      'employees': 'Employee',
      'messages': 'Message',
      'users': 'User',
      'profiles': 'Profile',
      'audit_logs': 'AuditLog',
      'message_templates': 'MessageTemplate',
      'webhook_logs': 'WebhookLog',
      'event_categories': 'EventCategory',
      'customer_category_stats': 'CustomerCategoryStat',
      'employee_notes': 'EmployeeNote',
      'employee_attachments': 'EmployeeAttachment',
      'employee_emergency_contacts': 'EmployeeEmergencyContact',
      'employee_health_records': 'EmployeeHealthRecord',
      'employee_financial_details': 'EmployeeFinancialDetails',
    }
    
    const issues: string[] = []
    
    // Check each table
    for (const [tableName, columns] of Object.entries(sqlSchema)) {
      const typeName = tableTypeMap[tableName]
      
      if (!typeName) {
        continue // Skip unmapped tables
      }
      
      const tsType = tsTypes[typeName]
      
      if (!tsType) {
        issues.push(`❌ Missing TypeScript type for table '${tableName}' (expected type '${typeName}')`)
        continue
      }
      
      console.log(`\nChecking ${tableName} => ${typeName}:`)
      
      // Check each column
      for (const column of columns) {
        const expectedTsType = sqlToTsType(column.type)
        const actualTsType = tsType[column.name]
        
        if (!actualTsType) {
          if (!['created_at', 'updated_at', 'deleted_at'].includes(column.name)) {
            console.log(`  ⚠️  Column '${column.name}' missing in TypeScript type`)
            issues.push(`Missing property '${column.name}' in type '${typeName}'`)
          }
        } else {
          // Basic type compatibility check
          const tsBaseType = actualTsType.replace(/\s*\|\s*null/g, '').replace(/\s*\|\s*undefined/g, '').trim()
          
          if (tsBaseType !== expectedTsType && tsBaseType !== 'any') {
            console.log(`  ⚠️  Type mismatch for '${column.name}': SQL ${column.type} => TS ${actualTsType}`)
          } else {
            console.log(`  ✅ ${column.name}: ${column.type} => ${actualTsType}`)
          }
        }
      }
    }
    
    // Summary
    console.log('\n📋 Summary:')
    console.log(`Total tables analyzed: ${Object.keys(sqlSchema).length}`)
    console.log(`Total issues found: ${issues.length}`)
    
    if (issues.length > 0) {
      console.log('\n❌ Issues found:')
      issues.forEach(issue => console.log(`  - ${issue}`))
    } else {
      console.log('\n✅ All schema types are consistent!')
    }
    
  } catch (error: any) {
    console.error('Error analyzing schema:', error.message)
  }
}

analyzeSchemaConsistency()