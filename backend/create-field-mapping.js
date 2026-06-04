const fs = require('fs');
const path = require('path');

// Read the analysis file
const analysisPath = path.join(__dirname, 'sap-field-analysis.json');
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));

console.log('=== SAP Data Analysis Summary ===\n');
console.log(`Total Rows: ${analysis.totalRows}`);
console.log(`Sheet Name: ${analysis.sheetName}`);

// Analyze field mapping
const fieldMapping = analysis.fieldMapping;
console.log(`\nTotal Columns: ${fieldMapping.length}\n`);

// Categorize fields by user role based on colorLegendRow2
const userRoles = {
  'TRADING': [],
  'LOGISTICS': [],
  'TRUCKING': [],
  'FINANCE': [],
  'MANAGEMENT': [],
  'VESSEL_ANALYSIS': [],
  'TRUCKING_ANALYSIS': [],
  'QUALITY': [],
  'ALL': [],
  'DATABASE': []
};

// Process each field
fieldMapping.forEach(field => {
  if (!field.header) return;
  
  const mapping = {
    columnIndex: field.columnIndex,
    header: field.header,
    sapField: field.sapField1 || field.sapField2 || '',
    sampleData: field.sampleData,
    userRole: 'UNKNOWN'
  };
  
  // Determine user role from colorLegendRow2
  const legend = field.colorLegend2 || field.colorLegend1 || '';
  
  if (legend.includes('Trader')) {
    mapping.userRole = 'TRADING';
    userRoles.TRADING.push(mapping);
  } else if (legend.includes('Logistics Trucking')) {
    mapping.userRole = 'LOGISTICS';
    userRoles.LOGISTICS.push(mapping);
  } else if (legend.includes('Trucking Analysis')) {
    mapping.userRole = 'TRUCKING_ANALYSIS';
    userRoles.TRUCKING_ANALYSIS.push(mapping);
  } else if (legend.includes('Vessel Analysis')) {
    mapping.userRole = 'VESSEL_ANALYSIS';
    userRoles.VESSEL_ANALYSIS.push(mapping);
  } else if (legend.includes('Quality')) {
    mapping.userRole = 'QUALITY';
    userRoles.QUALITY.push(mapping);
  } else if (legend.includes('Database')) {
    mapping.userRole = 'DATABASE';
    userRoles.DATABASE.push(mapping);
  } else if (legend === 'ALL') {
    mapping.userRole = 'ALL';
    userRoles.ALL.push(mapping);
  }
});

// Display summary by role
console.log('=== Fields by User Role ===\n');
Object.keys(userRoles).forEach(role => {
  if (userRoles[role].length > 0) {
    console.log(`\n${role} (${userRoles[role].length} fields):`);
    console.log('----------------------------------------');
    userRoles[role].slice(0, 10).forEach(field => {
      console.log(`  - ${field.header}`);
      if (field.sapField) console.log(`    SAP: ${field.sapField.substring(0, 80)}...`);
    });
    if (userRoles[role].length > 10) {
      console.log(`  ... and ${userRoles[role].length - 10} more fields`);
    }
  }
});

// Create a comprehensive database mapping
const databaseMapping = {
  analysis: {
    totalColumns: fieldMapping.length,
    totalDataRows: analysis.sampleDataRows.length,
    userRoleBreakdown: Object.keys(userRoles).map(role => ({
      role,
      fieldCount: userRoles[role].length
    }))
  },
  fieldsByRole: userRoles,
  allFields: fieldMapping.filter(f => f.header).map(f => ({
    header: f.header,
    sapSource: f.sapField1 || f.sapField2 || 'MANUAL_INPUT',
    columnIndex: f.columnIndex,
    sampleData: f.sampleData
  }))
};

// Save to file
const outputPath = path.join(__dirname, 'sap-database-mapping.json');
fs.writeFileSync(outputPath, JSON.stringify(databaseMapping, null, 2));
console.log(`\n\n=== Complete mapping saved to: ${outputPath} ===`);

// Create SQL field mapping insert statements
console.log('\n\n=== SQL INSERT Statements for Field Mappings ===\n');
const sqlStatements = [];
let sortOrder = 1;

Object.keys(userRoles).forEach(role => {
  userRoles[role].forEach(field => {
    if (!field.header) return;
    
    const sapFieldName = field.header.replace(/'/g, "''");
    const displayName = field.header.replace(/'/g, "''");
    const fieldType = 'text'; // Default, can be refined
    const isFromSap = field.sapField ? 'true' : 'false';
    
    sqlStatements.push(
      `INSERT INTO sap_field_mappings (sap_field_name, display_name, field_type, user_role, is_required, is_editable, sort_order) 
       VALUES ('${sapFieldName}', '${displayName}', '${fieldType}', '${role}', false, ${!field.sapField}, ${sortOrder++}) 
       ON CONFLICT (sap_field_name, user_role) DO NOTHING;`
    );
  });
});

// Save SQL to file
const sqlPath = path.join(__dirname, 'insert-field-mappings.sql');
fs.writeFileSync(sqlPath, sqlStatements.join('\n\n'));
console.log(`SQL statements saved to: ${sqlPath}`);
console.log(`Total SQL statements: ${sqlStatements.length}`);

