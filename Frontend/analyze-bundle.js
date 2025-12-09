const fs = require("fs");
const path = require("path");

// Simple bundle size analyzer
function analyzeBundle() {
  const distPath = path.join(__dirname, "dist", "topology");

  if (!fs.existsSync(distPath)) {
    console.log("❌ Build directory not found. Run npm run build:prod first.");
    return;
  }

  const files = fs.readdirSync(distPath);
  const jsFiles = files.filter((file) => file.endsWith(".js"));

  console.log("📊 Bundle Analysis:");
  console.log("==================");

  let totalSize = 0;

  jsFiles.forEach((file) => {
    const filePath = path.join(distPath, file);
    const stats = fs.statSync(filePath);
    const sizeInKB = (stats.size / 1024).toFixed(2);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    totalSize += stats.size;

    if (stats.size > 1024 * 1024) {
      console.log(`🔴 ${file}: ${sizeInMB} MB`);
    } else if (stats.size > 100 * 1024) {
      console.log(`🟡 ${file}: ${sizeInKB} KB`);
    } else {
      console.log(`🟢 ${file}: ${sizeInKB} KB`);
    }
  });

  const totalSizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
  console.log("==================");
  console.log(`📦 Total Bundle Size: ${totalSizeInMB} MB`);

  // Recommendations
  if (totalSize > 2 * 1024 * 1024) {
    console.log("\n💡 Optimization Recommendations:");
    console.log("• Consider implementing lazy loading for components");
    console.log("• Review and optimize heavy third-party libraries");
    console.log("• Implement tree-shaking for unused code");
    console.log("• Use dynamic imports for large features");
  }
}

analyzeBundle();
