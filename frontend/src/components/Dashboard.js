import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, RefreshCw, Download, AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';

const BRAND_GROUPS = [
  { own: 'Operational Falafel', competitors: ['Zaatar w Zeit', 'Aloo Beirut'] },
  { own: 'Sushi DO', competitors: ['Sushi Buzz', 'Sushi Art'] },
  { own: 'Right Bite', competitors: ['The 500 Calorie Project', 'Kcal'] },
  { own: 'Chin Chin', competitors: ['Mandarin Oak', 'China Bistro'] },
  { own: 'Taqado', competitors: ['Tortilla', 'Chipotle'] },
  { own: 'Pizzaro', competitors: ['Pizza di Rocco', 'Oregano'] },
  { own: 'Biryani Pot', competitors: ['Gazebo', 'Art of Dum'] },
  { own: 'Luca', competitors: ['Pasta Della Nonna', 'The Pasta Cup'] },
  { own: 'High Joint', competitors: ['Just Burger', 'Krush Burger'] },
  { own: 'Hot Bun Sliders', competitors: ['Slider Stop'] },
  { own: 'Awani', competitors: ['Bait Maryam', 'Al Safadi'] },
  { own: 'Zaroob', competitors: ['Allo Beirut', 'Barbar'] },
  { own: 'Circle Cafe', competitors: ['LDC', 'Jones the Grocer'] },
];

const ALL_BRANDS = BRAND_GROUPS.flatMap(g => [g.own, ...g.competitors]);

const Dashboard = () => {
  const [baselineData, setBaselineData] = useState(null);
  const [scrapeDate, setScrapeDate] = useState('');
  const [comparisonResults, setComparisonResults] = useState(null);
  const [warnings, setWarnings] = useState([]);

  // Parse Master File (Baseline)
  const handleMasterUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const baseline = {};
        let totalBrands = 0;
        let totalItems = 0;

        const skipKeywords = [
          'Executive Summary',
          'Price History',
          'Trend Data',
          'Price Increases',
          'Price Decreases',
        ];

        workbook.SheetNames.forEach((sheetName) => {
          // Skip sheets containing specific keywords
          const shouldSkip = skipKeywords.some((keyword) =>
            sheetName.includes(keyword)
          );
          if (shouldSkip) return;

          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

          // Read columns G (index 6) and H (index 7) from rows 6-605
          const items = {};
          for (let i = 5; i < Math.min(605, jsonData.length); i++) {
            const row = jsonData[i];
            if (!row) continue;

            const itemName = row[6]; // Column G
            const price = row[7]; // Column H

            if (itemName && price !== undefined && price !== null && price !== '') {
              const trimmedName = String(itemName).trim();
              const parsedPrice = parseFloat(price);
              if (trimmedName && !isNaN(parsedPrice)) {
                items[trimmedName] = parsedPrice;
                totalItems++;
              }
            }
          }

          if (Object.keys(items).length > 0) {
            baseline[sheetName] = items;
            totalBrands++;
          }
        });

        setBaselineData(baseline);
        toast.success(`✓ Master loaded — ${totalBrands} brands, ${totalItems} baseline items`);
      } catch (error) {
        console.error('Error parsing master file:', error);
        toast.error('Error parsing master file. Please check the file format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Parse Scrape Files
  const handleScrapeUpload = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!baselineData) {
      toast.error('Please upload the Master file first');
      return;
    }
    if (!scrapeDate) {
      toast.error('Please enter the scrape date');
      return;
    }

    const scrapeData = {};
    let filesProcessed = 0;

    const processFile = (file) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            workbook.SheetNames.forEach((sheetName) => {
              const sheet = workbook.Sheets[sheetName];
              const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

              // Row 1 = headers, Row 2+ = data
              // Column A = Category, Column B = Item Name, Column C = Price
              const items = {};
              for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row) continue;

                const itemName = row[1]; // Column B
                const price = row[2]; // Column C

                if (itemName && price !== undefined && price !== null && price !== '') {
                  const trimmedName = String(itemName).trim();
                  const parsedPrice = parseFloat(price);
                  if (trimmedName && !isNaN(parsedPrice)) {
                    items[trimmedName] = parsedPrice;
                  }
                }
              }

              if (Object.keys(items).length > 0) {
                scrapeData[sheetName] = items;
              }
            });
            resolve();
          } catch (error) {
            console.error('Error parsing scrape file:', error);
            resolve();
          }
        };
        reader.readAsArrayBuffer(file);
      });
    };

    const promises = [];
    for (let i = 0; i < files.length; i++) {
      promises.push(processFile(files[i]));
    }

    Promise.all(promises).then(() => {
      // Compare scrape vs baseline
      const results = compareData(baselineData, scrapeData);
      setComparisonResults(results);
      toast.success(`✓ Comparison complete — ${Object.keys(scrapeData).length} brands analyzed`);
    });
  };

  const compareData = (baseline, scrape) => {
    const brandResults = {};
    const newWarnings = [];

    // Check each brand in BRAND_GROUPS
    ALL_BRANDS.forEach((brandName) => {
      const baselineItems = baseline[brandName] || {};
      const scrapeItems = scrape[brandName] || {};

      const baselineKeys = Object.keys(baselineItems);
      const scrapeKeys = Object.keys(scrapeItems);

      if (scrapeKeys.length === 0 && baselineKeys.length > 0) {
        newWarnings.push(`⚠️ ${brandName}: Missing in scrape files`);
      }

      let priceUp = 0;
      let priceDown = 0;
      let newItems = 0;
      let removed = 0;
      let noChange = 0;

      // Check items in scrape
      scrapeKeys.forEach((itemName) => {
        const scrapePrice = scrapeItems[itemName];
        const baselinePrice = baselineItems[itemName];

        if (baselinePrice === undefined) {
          newItems++;
        } else {
          if (scrapePrice > baselinePrice) {
            priceUp++;
          } else if (scrapePrice < baselinePrice) {
            priceDown++;
          } else {
            noChange++;
          }
        }
      });

      // Check removed items (in baseline but not in scrape)
      baselineKeys.forEach((itemName) => {
        if (scrapeItems[itemName] === undefined) {
          removed++;
        }
      });

      const total = scrapeKeys.length;
      const changePercent = total > 0 ? ((priceUp + priceDown) / total) * 100 : 0;

      brandResults[brandName] = {
        priceUp,
        priceDown,
        newItems,
        removed,
        noChange,
        total,
        changePercent,
      };
    });

    setWarnings(newWarnings);
    return brandResults;
  };

  const calculateTotals = (results, ownBrandsOnly = false) => {
    const ownBrands = BRAND_GROUPS.map((g) => g.own);
    const totals = {
      priceUp: 0,
      priceDown: 0,
      newItems: 0,
      removed: 0,
      noChange: 0,
      total: 0,
    };

    Object.keys(results).forEach((brand) => {
      if (ownBrandsOnly && !ownBrands.includes(brand)) return;
      const data = results[brand];
      totals.priceUp += data.priceUp;
      totals.priceDown += data.priceDown;
      totals.newItems += data.newItems;
      totals.removed += data.removed;
      totals.noChange += data.noChange;
      totals.total += data.total;
    });

    return totals;
  };

  const exportResults = () => {
    if (!comparisonResults) return;

    const exportData = [];
    exportData.push(['Brand', 'Type', 'Price Up', 'Price Down', 'New Items', 'Removed', 'No Change', 'Total', 'Change %']);

    BRAND_GROUPS.forEach((group) => {
      const ownData = comparisonResults[group.own] || {};
      exportData.push([
        group.own,
        'OWN',
        ownData.priceUp || 0,
        ownData.priceDown || 0,
        ownData.newItems || 0,
        ownData.removed || 0,
        ownData.noChange || 0,
        ownData.total || 0,
        ownData.changePercent ? ownData.changePercent.toFixed(1) + '%' : '0%',
      ]);

      group.competitors.forEach((comp) => {
        const compData = comparisonResults[comp] || {};
        exportData.push([
          comp,
          'COMP',
          compData.priceUp || 0,
          compData.priceDown || 0,
          compData.newItems || 0,
          compData.removed || 0,
          compData.noChange || 0,
          compData.total || 0,
          compData.changePercent ? compData.changePercent.toFixed(1) + '%' : '0%',
        ]);
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparison Results');
    XLSX.writeFile(wb, `Menu_Price_Tracker_${scrapeDate.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
    toast.success('✓ Results exported successfully');
  };

  const resetUpload = () => {
    setBaselineData(null);
    setScrapeDate('');
    setComparisonResults(null);
    setWarnings([]);
  };

  const renderUploadSection = () => (
    <div className="min-h-screen flex items-center justify-center p-6" data-testid="upload-section">
      <div className="w-full max-w-2xl space-y-6">
        {/* Logo/Title */}
        <div className="text-center space-y-2">
          <h1 className="text-5xl font-bold text-green-400" data-testid="app-title">📊 MENU PRICE TRACKER</h1>
          <p className="text-gray-400 text-lg" data-testid="app-subtitle">Talabat UAE · Competitive Pricing Intelligence</p>
        </div>

        {/* Step 1: Master File */}
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 space-y-4" data-testid="master-upload-card">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-400/10 flex items-center justify-center text-green-400 font-bold" data-testid="step-1-badge">
              1
            </div>
            <h2 className="text-xl font-semibold text-white" data-testid="step-1-title">Upload Master File</h2>
          </div>
          <p className="text-gray-400 text-sm" data-testid="step-1-description">
            Upload the Master_Price_Tracker_v3.xlsx file containing baseline data (24-Feb-25)
          </p>
          <div className="relative">
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleMasterUpload}
              className="bg-[#0b0b0f] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20"
              data-testid="master-file-input"
            />
          </div>
          {baselineData && (
            <div className="flex items-center gap-2 text-green-400 text-sm" data-testid="master-success-message">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Master loaded — {Object.keys(baselineData).length} brands
            </div>
          )}
        </div>

        {/* Step 2: Scrape Files */}
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 space-y-4" data-testid="scrape-upload-card">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-400/10 flex items-center justify-center text-green-400 font-bold" data-testid="step-2-badge">
              2
            </div>
            <h2 className="text-xl font-semibold text-white" data-testid="step-2-title">Upload Scrape Files + Set Date</h2>
          </div>
          <p className="text-gray-400 text-sm" data-testid="step-2-description">
            Enter the scrape date and upload current menu price files (e.g., 01_Operational_Falafel.xlsx)
          </p>
          <div className="space-y-3">
            <Input
              type="text"
              placeholder="e.g. 10-Mar-25"
              value={scrapeDate}
              onChange={(e) => setScrapeDate(e.target.value)}
              className="bg-[#0b0b0f] border-[#1a1a1f] text-white placeholder:text-gray-500"
              data-testid="scrape-date-input"
            />
            <Input
              type="file"
              accept=".xlsx,.xls"
              multiple
              onChange={handleScrapeUpload}
              disabled={!baselineData}
              className="bg-[#0b0b0f] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="scrape-files-input"
            />
          </div>
        </div>

        {!baselineData && (
          <p className="text-center text-gray-500 text-sm" data-testid="upload-instruction">
            Start by uploading the Master file to load baseline data
          </p>
        )}
      </div>
    </div>
  );

  const renderDashboard = () => {
    const ownTotals = calculateTotals(comparisonResults, true);
    const changeRate = ownTotals.total > 0 ? ((ownTotals.priceUp + ownTotals.priceDown + ownTotals.newItems) / ownTotals.total) * 100 : 0;

    return (
      <div className="min-h-screen p-6" data-testid="dashboard-section">
        {/* Header */}
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6" data-testid="dashboard-header">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-green-400 mb-1" data-testid="dashboard-title">📊 MENU PRICE TRACKER</h1>
              <p className="text-gray-400 text-sm" data-testid="dashboard-subtitle">
                Talabat UAE · 13 Own Brands · Cumulative from 24-Feb-25 · Scrape: {scrapeDate}
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={exportResults}
                variant="outline"
                className="bg-[#0b0b0f] border-[#1a1a1f] text-green-400 hover:bg-green-400/10"
                data-testid="export-button"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button
                onClick={resetUpload}
                variant="outline"
                className="bg-[#0b0b0f] border-[#1a1a1f] text-white hover:bg-white/10"
                data-testid="reset-button"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                New Upload
              </Button>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6" data-testid="warnings-section">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-yellow-500 font-semibold mb-2" data-testid="warnings-title">Warnings</h3>
                <ul className="space-y-1 text-sm text-yellow-500/80">
                  {warnings.map((warning, idx) => (
                    <li key={idx} data-testid={`warning-${idx}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6" data-testid="kpi-cards">
          <div className="bg-[#101014] border border-green-400/30 rounded-lg p-4" data-testid="kpi-price-up">
            <div className="text-green-400 text-2xl font-bold">{ownTotals.priceUp}</div>
            <div className="text-gray-400 text-sm mt-1">▲ Price Up</div>
          </div>
          <div className="bg-[#101014] border border-red-400/30 rounded-lg p-4" data-testid="kpi-price-down">
            <div className="text-red-400 text-2xl font-bold">{ownTotals.priceDown}</div>
            <div className="text-gray-400 text-sm mt-1">▼ Price Down</div>
          </div>
          <div className="bg-[#101014] border border-cyan-400/30 rounded-lg p-4" data-testid="kpi-new-items">
            <div className="text-cyan-400 text-2xl font-bold">{ownTotals.newItems}</div>
            <div className="text-gray-400 text-sm mt-1">🟢 New Items</div>
          </div>
          <div className="bg-[#101014] border border-purple-400/30 rounded-lg p-4" data-testid="kpi-removed">
            <div className="text-purple-400 text-2xl font-bold">{ownTotals.removed}</div>
            <div className="text-gray-400 text-sm mt-1">🔴 Removed</div>
          </div>
          <div className="bg-[#101014] border border-gray-400/30 rounded-lg p-4" data-testid="kpi-no-change">
            <div className="text-gray-400 text-2xl font-bold">{ownTotals.noChange}</div>
            <div className="text-gray-400 text-sm mt-1">✅ No Change</div>
          </div>
          <div className="bg-[#101014] border border-blue-400/30 rounded-lg p-4" data-testid="kpi-total">
            <div className="text-blue-400 text-2xl font-bold">{ownTotals.total}</div>
            <div className="text-gray-400 text-sm mt-1">Total Items</div>
          </div>
        </div>

        {/* Change Rate Bar */}
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6" data-testid="change-rate-section">
          <h3 className="text-white font-semibold mb-3" data-testid="change-rate-title">Change Rate (Own Brands)</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-8 bg-[#0b0b0f] rounded-full overflow-hidden flex">
              <div
                className="bg-green-400 h-full"
                style={{ width: `${ownTotals.total > 0 ? (ownTotals.priceUp / ownTotals.total) * 100 : 0}%` }}
                data-testid="change-rate-up-bar"
              />
              <div
                className="bg-red-400 h-full"
                style={{ width: `${ownTotals.total > 0 ? (ownTotals.priceDown / ownTotals.total) * 100 : 0}%` }}
                data-testid="change-rate-down-bar"
              />
              <div
                className="bg-cyan-400 h-full"
                style={{ width: `${ownTotals.total > 0 ? (ownTotals.newItems / ownTotals.total) * 100 : 0}%` }}
                data-testid="change-rate-new-bar"
              />
            </div>
            <div className="text-white font-bold text-lg" data-testid="change-rate-percentage">{changeRate.toFixed(1)}%</div>
          </div>
        </div>

        {/* Brand Table */}
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden" data-testid="brand-table">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                  <th className="text-left p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-brand">BRAND</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-type">TYPE</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-up">▲ UP</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-down">▼ DN</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-new">🟢 NEW</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-removed">🔴 REM</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-nc">✅ NC</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-total">TOTAL</th>
                  <th className="text-center p-4 text-gray-400 font-semibold text-sm" data-testid="table-header-chg">CHG%</th>
                </tr>
              </thead>
              <tbody>
                {BRAND_GROUPS.map((group, groupIdx) => {
                  const ownData = comparisonResults[group.own] || {};
                  return (
                    <>
                      {/* Own Brand Row */}
                      <tr
                        key={`own-${groupIdx}`}
                        className="border-b border-[#1a1a1f] bg-green-400/5 hover:bg-green-400/10"
                        data-testid={`brand-row-own-${groupIdx}`}
                      >
                        <td className="p-4" data-testid={`brand-name-own-${groupIdx}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-green-400">⭐</span>
                            <span className="text-white font-semibold">{group.own}</span>
                          </div>
                        </td>
                        <td className="text-center p-4" data-testid={`brand-type-own-${groupIdx}`}>
                          <span className="inline-block px-2 py-1 rounded-full bg-green-400/20 text-green-400 text-xs font-semibold">
                            OWN
                          </span>
                        </td>
                        <td className="text-center p-4" data-testid={`brand-up-own-${groupIdx}`}>
                          {ownData.priceUp > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-green-400/20 text-green-400 text-sm font-semibold">
                              {ownData.priceUp}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4" data-testid={`brand-down-own-${groupIdx}`}>
                          {ownData.priceDown > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-red-400/20 text-red-400 text-sm font-semibold">
                              {ownData.priceDown}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4" data-testid={`brand-new-own-${groupIdx}`}>
                          {ownData.newItems > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-semibold">
                              {ownData.newItems}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4" data-testid={`brand-removed-own-${groupIdx}`}>
                          {ownData.removed > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-purple-400/20 text-purple-400 text-sm font-semibold">
                              {ownData.removed}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4" data-testid={`brand-nc-own-${groupIdx}`}>
                          {ownData.noChange > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 text-sm font-semibold">
                              {ownData.noChange}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4" data-testid={`brand-total-own-${groupIdx}`}>
                          <span className="text-blue-400 font-semibold">{ownData.total || 0}</span>
                        </td>
                        <td className="text-center p-4" data-testid={`brand-chg-own-${groupIdx}`}>
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                              ownData.changePercent > 50
                                ? 'bg-red-400/20 text-red-400'
                                : ownData.changePercent > 20
                                ? 'bg-yellow-400/20 text-yellow-400'
                                : 'bg-green-400/20 text-green-400'
                            }`}
                          >
                            {ownData.changePercent ? ownData.changePercent.toFixed(1) : '0.0'}%
                          </span>
                        </td>
                      </tr>

                      {/* Competitor Rows */}
                      {group.competitors.map((comp, compIdx) => {
                        const compData = comparisonResults[comp] || {};
                        return (
                          <tr
                            key={`comp-${groupIdx}-${compIdx}`}
                            className="border-b border-[#1a1a1f] hover:bg-white/5"
                            data-testid={`brand-row-comp-${groupIdx}-${compIdx}`}
                          >
                            <td className="p-4 pl-8" data-testid={`brand-name-comp-${groupIdx}-${compIdx}`}>
                              <span className="text-gray-300">{comp}</span>
                            </td>
                            <td className="text-center p-4" data-testid={`brand-type-comp-${groupIdx}-${compIdx}`}>
                              <span className="inline-block px-2 py-1 rounded-full bg-gray-600/20 text-gray-400 text-xs font-semibold">
                                COMP
                              </span>
                            </td>
                            <td className="text-center p-4" data-testid={`brand-up-comp-${groupIdx}-${compIdx}`}>
                              {compData.priceUp > 0 ? (
                                <span className="inline-block px-3 py-1 rounded-full bg-green-400/20 text-green-400 text-sm font-semibold">
                                  {compData.priceUp}
                                </span>
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </td>
                            <td className="text-center p-4" data-testid={`brand-down-comp-${groupIdx}-${compIdx}`}>
                              {compData.priceDown > 0 ? (
                                <span className="inline-block px-3 py-1 rounded-full bg-red-400/20 text-red-400 text-sm font-semibold">
                                  {compData.priceDown}
                                </span>
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </td>
                            <td className="text-center p-4" data-testid={`brand-new-comp-${groupIdx}-${compIdx}`}>
                              {compData.newItems > 0 ? (
                                <span className="inline-block px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-semibold">
                                  {compData.newItems}
                                </span>
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </td>
                            <td className="text-center p-4" data-testid={`brand-removed-comp-${groupIdx}-${compIdx}`}>
                              {compData.removed > 0 ? (
                                <span className="inline-block px-3 py-1 rounded-full bg-purple-400/20 text-purple-400 text-sm font-semibold">
                                  {compData.removed}
                                </span>
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </td>
                            <td className="text-center p-4" data-testid={`brand-nc-comp-${groupIdx}-${compIdx}`}>
                              {compData.noChange > 0 ? (
                                <span className="inline-block px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 text-sm font-semibold">
                                  {compData.noChange}
                                </span>
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </td>
                            <td className="text-center p-4" data-testid={`brand-total-comp-${groupIdx}-${compIdx}`}>
                              <span className="text-blue-400 font-semibold">{compData.total || 0}</span>
                            </td>
                            <td className="text-center p-4" data-testid={`brand-chg-comp-${groupIdx}-${compIdx}`}>
                              <span
                                className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                                  compData.changePercent > 50
                                    ? 'bg-red-400/20 text-red-400'
                                    : compData.changePercent > 20
                                    ? 'bg-yellow-400/20 text-yellow-400'
                                    : 'bg-green-400/20 text-green-400'
                                }`}
                              >
                                {compData.changePercent ? compData.changePercent.toFixed(1) : '0.0'}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}

                      {/* Separator between groups */}
                      {groupIdx < BRAND_GROUPS.length - 1 && (
                        <tr key={`separator-${groupIdx}`}>
                          <td colSpan="9" className="h-2 bg-[#0b0b0f]"></td>
                        </tr>
                      )}
                    </>
                  );
                })}

                {/* Total Row */}
                <tr className="border-t-2 border-green-400/50 bg-green-400/10" data-testid="brand-row-total">
                  <td className="p-4" colSpan="2" data-testid="brand-total-label">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 text-lg">🏆</span>
                      <span className="text-white font-bold">ALL OWN BRANDS</span>
                    </div>
                  </td>
                  <td className="text-center p-4" data-testid="brand-total-up">
                    <span className="inline-block px-3 py-1 rounded-full bg-green-400/20 text-green-400 text-sm font-bold">
                      {ownTotals.priceUp}
                    </span>
                  </td>
                  <td className="text-center p-4" data-testid="brand-total-down">
                    <span className="inline-block px-3 py-1 rounded-full bg-red-400/20 text-red-400 text-sm font-bold">
                      {ownTotals.priceDown}
                    </span>
                  </td>
                  <td className="text-center p-4" data-testid="brand-total-new">
                    <span className="inline-block px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-bold">
                      {ownTotals.newItems}
                    </span>
                  </td>
                  <td className="text-center p-4" data-testid="brand-total-removed">
                    <span className="inline-block px-3 py-1 rounded-full bg-purple-400/20 text-purple-400 text-sm font-bold">
                      {ownTotals.removed}
                    </span>
                  </td>
                  <td className="text-center p-4" data-testid="brand-total-nc">
                    <span className="inline-block px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 text-sm font-bold">
                      {ownTotals.noChange}
                    </span>
                  </td>
                  <td className="text-center p-4" data-testid="brand-total-total">
                    <span className="text-blue-400 font-bold text-lg">{ownTotals.total}</span>
                  </td>
                  <td className="text-center p-4" data-testid="brand-total-chg">
                    <span className="text-green-400 font-bold text-lg">{changeRate.toFixed(1)}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-gray-500 text-sm" data-testid="dashboard-footer">
          COMPETITIVE PRICING INTELLIGENCE · TALABAT UAE
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0b0b0f]">
      {comparisonResults ? renderDashboard() : renderUploadSection()}
    </div>
  );
};

export default Dashboard;
