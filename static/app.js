const API_BASE = "https://factory-dashboard-ajd9.onrender.com";

const machineDisplayNames = {
    OP1: "Plug Bleeder Tightening & Mark Lot No.",
    OP2: "Seat Union Press In",
    OP5: "Piston Press In & Thorugh Hole Check",
    OP7: "Bolt Tightening No.1",
    OP8: "Bolt Tightening No.2",
    OP9: "Low Leak Test",
    OP10: "High Pressure Load",
    OP11: "Med Leak Test No.1",
    OP12: "Med Leak Test No.2",
    OP13: "Pad Assembly"
};

async function loadTimelineFromDB() {
    try {
        const res = await fetch(`${API_BASE}/api/timeline`);
        const data = await res.json();

        Object.assign(shiftHistory, data);

    } catch (error) {
        console.error("Load timeline error:", error);
    }
}


async function saveTimelineToDB(machineName, shift, blockIndex, status) {
    try {
        await fetch(`${API_BASE}/api/timeline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                machineName: machineName,
                shift: shift,
                blockIndex: blockIndex,
                status: status
            })
        });
    } catch (error) {
        console.error("Save timeline error:", error);
    }
}

let productionChart;
const shiftHistory = {}; // เก็บข้อมูลประวัติแยกตามกะ { 'OP1': { 'day': [], 'night': [] }, ... }

function saveShiftHistory() {
    localStorage.setItem('shiftHistory', JSON.stringify(shiftHistory));
}

function loadShiftHistory() {
    const saved = localStorage.getItem('shiftHistory');

    if (saved) {
        Object.assign(shiftHistory, JSON.parse(saved));
    }
}

let virtualTime = null;
let simulationTimer = null;
let lastShift = '';
let lastIndex = -1;

// Number of blocks to render for each shift timeline (12 hours)
const SHIFT_BLOCKS = 360;

// Settings State
let targetMode = 'manual';
let manualTargetValue = 500;
let idealCycleTime = 10.0;
let stopDetectionMultiplier = 1.0; // fraction of CT used for Stop detection

let lastOkCount = 0;
let lastOkActivitySeconds = 0;

// Production Tracking for Dashboard Chart
let hourlyHistory = {}; // Persistent hourly totals
function saveHourlyHistory() {
    localStorage.setItem('hourlyHistory', JSON.stringify(hourlyHistory));
}

function loadHourlyHistory() {
    const saved = localStorage.getItem('hourlyHistory');
    if (saved) {
        hourlyHistory = JSON.parse(saved);
    }
}

function saveChartData() {
    if (!productionChart) return;

    localStorage.setItem('productionChartData', JSON.stringify({
        labels: productionChart.data.labels,
        good: productionChart.data.datasets[0].data,
        ng: productionChart.data.datasets[1].data
    }));
}

function loadChartData() {
    const saved = localStorage.getItem('productionChartData');
    if (!saved || !productionChart) return;

    const data = JSON.parse(saved);

    productionChart.data.labels = data.labels;
    productionChart.data.datasets[0].data = data.good;
    productionChart.data.datasets[1].data = data.ng;
    productionChart.update();
}

function toggleTargetMode() {
    targetMode = document.querySelector('input[name="target-mode"]:checked').value;
    document.getElementById('manual-target-input').style.display = targetMode === 'manual' ? 'block' : 'none';
    document.getElementById('auto-target-input').style.display = targetMode === 'auto' ? 'block' : 'none';
}

async function changeMachineStatus(name, status) {
    try {
        // Keep current counts if available by reading DOM; fallback to 0
        const okEl = document.getElementById('actual-qty');
        const ngEl = document.getElementById('ng-qty');
        const currentOk = okEl ? parseInt(okEl.innerText) : 0;
        const currentNg = ngEl ? parseInt(ngEl.innerText) : 0;

        await fetch(`${API_BASE}/api/machine/${encodeURIComponent(name)}/update?status=${encodeURIComponent(status)}&good_qty=${currentOk}&ng_qty=${currentNg}`, { method: 'POST' });
        // Refresh machines list to show updated status
        fetchAllMachines();
    } catch (e) {
        console.error('Failed to change machine status', e);
        alert('Failed to update status for ' + name);
    }
}

async function saveSettings() {

    const selectedMode = document.querySelector('input[name="target-mode"]:checked');

    targetMode = selectedMode ? selectedMode.value : 'manual';

    manualTargetValue = parseInt(document.getElementById('input-manual-target').value) || 500;

    idealCycleTime = parseFloat(document.getElementById('input-cycle-time').value) || 10.0;

    stopDetectionMultiplier = parseFloat(document.getElementById('input-stop-ct').value) || 1.0;

    console.log("Saving target mode:", targetMode);

    await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            targetMode: targetMode,
            manualTargetValue: manualTargetValue,
            idealCycleTime: idealCycleTime,
            stopDetectionMultiplier: stopDetectionMultiplier
        })
    });

    alert("Settings saved successfully!");

    await loadSettings();

    fetchData();
}

async function loadSettings() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        const settings = await res.json();

        targetMode = settings.targetMode || 'manual';
        manualTargetValue = settings.manualTargetValue || 500;
        idealCycleTime = settings.idealCycleTime || 10.0;
        stopDetectionMultiplier = settings.stopDetectionMultiplier || 1.0;

        const radio = document.querySelector(`input[name="target-mode"][value="${targetMode}"]`);
        if (radio) radio.checked = true;

        document.getElementById('input-manual-target').value = manualTargetValue;
        document.getElementById('input-cycle-time').value = idealCycleTime;
        document.getElementById('input-stop-ct').value = stopDetectionMultiplier;

        toggleTargetMode();

    } catch (error) {
        console.error("Load settings error:", error);
    }
}

function trackOkActivity(machine) {
    const { elapsedSeconds } = getCurrentShiftInfo();
    const okCount = machine.current_good_count || 0;

    if (okCount !== lastOkCount) {
        lastOkCount = okCount;
        lastOkActivitySeconds = elapsedSeconds;
    }

    return { okCount, elapsedSeconds };
}

function computeLineStatus(okCount, elapsedSeconds) {
    const stopThreshold = idealCycleTime * stopDetectionMultiplier;
    const secondsSinceLastOk = elapsedSeconds - lastOkActivitySeconds;

    if (secondsSinceLastOk >= stopThreshold) {
        return 'STOP';
    }

    return 'RUN';
}

async function resetAllProductionData() {
    if (confirm("คุณต้องการล้างข้อมูลการผลิตทั้งหมด (Actual, NG) และล้างแถบสถานะใช่หรือไม่?")) {
        try {
            // 1. Reset backend counts for AS001
            await fetch(`${API_BASE}/api/machine/AS001/update?status=STOP&good_qty=0&ng_qty=0`, { method: 'POST' });
            
            // 2. Clear local shift history for all machines
            Object.keys(shiftHistory).forEach(name => {
                shiftHistory[name].day = new Array(SHIFT_BLOCKS).fill(null);
                shiftHistory[name].night = new Array(SHIFT_BLOCKS).fill(null);
            });

            // 3. Clear Chart and Hourly History
            hourlyHistory = {};

            localStorage.removeItem('hourlyHistory');
            localStorage.removeItem('productionChartData');

            if (productionChart) {
                productionChart.data.datasets[0].data = new Array(productionChart.data.labels.length).fill(0);
                productionChart.data.datasets[1].data = new Array(productionChart.data.labels.length).fill(0);
                productionChart.update();
            }
            const totalsRow = document.getElementById('hourly-totals-row');
            if (totalsRow) totalsRow.innerHTML = '';
            
            alert("Data reset successful!");
            fetchData();
            fetchAllMachines();
        } catch (e) {
            console.error(e);
        }
    }
}

function getCurrentShiftInfo() {
    const now = virtualTime || new Date();
    const currentTimeSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const dayStartSeconds = 8 * 3600 + 20 * 60; // 08:20:00
    const dayEndSeconds = 20 * 3600 + 20 * 60;   // 20:20:00
    
    // คำนวณหาตำแหน่ง (Index) ในแถบ 12 ชม. (360 บล็อก, บล็อกละ 2 นาที)
    let shift = 'night';
    let secondsIntoShift = 0;
    
    if (currentTimeSeconds >= dayStartSeconds && currentTimeSeconds < dayEndSeconds) {
        shift = 'day';
        secondsIntoShift = currentTimeSeconds - dayStartSeconds;
    } else {
        shift = 'night';
        if (currentTimeSeconds >= dayEndSeconds) {
            secondsIntoShift = currentTimeSeconds - dayEndSeconds;
        } else {
            secondsIntoShift = (currentTimeSeconds + 24 * 3600) - dayEndSeconds;
        }
    }
    
    let index = Math.floor(secondsIntoShift / 120);

    if (index < 0) index = 0;
    if (index >= SHIFT_BLOCKS) index = SHIFT_BLOCKS - 1;
    return { shift, index, elapsedSeconds: secondsIntoShift };
}

let lastAutoResetKey = "";

async function autoResetAtShiftChange() {
    const now = virtualTime || new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    const resetKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${hour}-${minute}`;

    if (lastAutoResetKey === resetKey) return;

    if (
        (hour === 8 && minute >= 20 && minute <= 21) ||
        (hour === 20 && minute >= 20 && minute <= 21)
    ) {
        console.log("Auto Reset Shift:", resetKey);

        lastAutoResetKey = resetKey;

        await resetShiftData();
    }
}

async function resetShiftData() {
    try {
        await fetch(`${API_BASE}/api/timeline`, {
            method: "DELETE"
        });

        Object.keys(shiftHistory).forEach(name => {
            shiftHistory[name].day = new Array(SHIFT_BLOCKS).fill(null);
            shiftHistory[name].night = new Array(SHIFT_BLOCKS).fill(null);
        });

        localStorage.removeItem("shiftHistory");
        localStorage.removeItem("hourlyHistory");
        localStorage.removeItem("productionChartData");

        hourlyHistory = {};

        if (productionChart) {
            productionChart.data.datasets[0].data.fill(0);
            productionChart.data.datasets[1].data.fill(0);
            productionChart.update();
        }

        await fetch(`${API_BASE}/api/machine/AS001/update?status=RUN&good_qty=0&ng_qty=0`, {
            method: "POST"
        });

        await fetch(`${API_BASE}/api/timeline`, {
        method: "DELETE"
        });

        const res = await fetch(`${API_BASE}/api/machines`);
        const machines = await res.json();

        for (const m of machines) {
            if (m.name !== "AS001") {
                await fetch(`${API_BASE}/api/machine/${encodeURIComponent(m.name)}/update?status=RUN&good_qty=0&ng_qty=0`, {
                    method: "POST"
                });
            }
        }

        if (productionChart) {
            productionChart.data.datasets[0].data = new Array(productionChart.data.labels.length).fill(0);
            productionChart.data.datasets[1].data = new Array(productionChart.data.labels.length).fill(0);
            productionChart.update();
        }

        fetchData();
        fetchAllMachines();

        console.log("Reset Actual, NG and Timeline complete");

    } catch (error) {
        console.error("Shift reset error:", error);
    }
}

function applySimulationSettings() {
    let interval = parseInt(document.getElementById('sim-interval').value);
    if (!interval || interval < 1) interval = 1;
    document.getElementById('sim-interval').value = interval;
    const skipMinutes = parseInt(document.getElementById('sim-skip').value) || 0;
    
    if (simulationTimer) clearInterval(simulationTimer);
    
    if (skipMinutes === 0) {
        virtualTime = null;
        document.getElementById('virtual-clock').innerText = "";
    } else {
        if (!virtualTime) virtualTime = new Date();
    }
    
    simulationTimer = setInterval(() => {
        if (virtualTime && skipMinutes > 0) {
            virtualTime.setMinutes(virtualTime.getMinutes() + skipMinutes);
            document.getElementById('virtual-clock').innerText = virtualTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        // ตรวจสอบการ Clear อัตโนมัติ (08:20 และ 20:20)
        const { shift, index } = getCurrentShiftInfo();
        if (index === 0 && (lastShift !== shift || lastIndex !== 0)) {
            console.log(`Auto clearing history for shift: ${shift}`);
            Object.keys(shiftHistory).forEach(name => {
                shiftHistory[name][shift] = new Array(SHIFT_BLOCKS).fill(null);
            });
        }
        lastShift = shift;
        lastIndex = index;

        fetchAllMachines();
    }, interval * 1000);
}

document.addEventListener('DOMContentLoaded', async () => {

    loadShiftHistory();
    loadHourlyHistory();

    await loadSettings();
    await loadTimelineFromDB();

    initChart();
    loadChartData();

    fetchData();
    loadAlarmsFromDB();

    setInterval(fetchData, 2000);
    setInterval(loadAlarmsFromDB, 2000);
    setInterval(autoResetAtShiftChange, 30000);
});

function initChart() {
    const ctx = document.getElementById('productionChart').getContext('2d');
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";
    
    productionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00'],
            datasets: [
                {
                    label: 'Good Qty',
                    data: [120, 135, 110, 140, 130, 0],
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderRadius: 4
                },
                {
                    label: 'NG Qty',
                    data: [2, 5, 1, 3, 4, 0],
                    backgroundColor: 'rgba(239, 68, 68, 0.8)',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', align: 'end' }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

async function fetchData() {
    try {
        // Fetch machine status
        const statusRes = await fetch(`${API_BASE}/api/machine/AS001`);
        const machine = await statusRes.json();
        
        // Fetch OEE
        const oeeRes = await fetch(`${API_BASE}/api/machine/AS001/oee`);
        
        // Fetch All Machines
        fetchAllMachines();
        const oeeData = await oeeRes.json();
        
        updateUI(machine, oeeData);
    } catch (err) {
        console.error("Error fetching data:", err);
    }
}

function updateUI(machine, oeeData) {
    // Update Status
    const statusText = document.getElementById('machine-status-text');
    const statusDot = document.getElementById('machine-status-dot');
    
    const { okCount, elapsedSeconds: elapsedSinceShiftStart } = trackOkActivity(machine);
    const computedStatus = computeLineStatus(okCount, elapsedSinceShiftStart);
    statusText.innerText = computedStatus;
    statusDot.className = `pulse-dot ${computedStatus.toLowerCase()}`;
    
    // Update Bekido (Operation Rate) based on Production and Cycle Time
    const { index } = getCurrentShiftInfo();
    const elapsedSeconds = index * 120; // 1 block = 2 minutes = 120 seconds
    const actual = machine.current_good_count;
    
    let bekido = 0;
    if (elapsedSeconds > 0) {
        // Bekido = (จำนวนที่ผลิตได้จริง * เวลาที่ควรใช้ต่อชิ้น) / เวลาที่ผ่านไปจริง
        bekido = ((actual * idealCycleTime) / elapsedSeconds) * 100;
        if (bekido > 100) bekido = 100; // Cap at 100% unless they are over-performing
    }
    
    document.getElementById('oee-value').innerText = bekido.toFixed(2);
    
    // Update Production Count
    let target = manualTargetValue;
    if (targetMode === 'auto') {
        const { index } = getCurrentShiftInfo();
        const elapsedSeconds = index * 120; // 1 block = 2 minutes = 120 seconds
        target = Math.floor(elapsedSeconds / idealCycleTime);
    }

    document.getElementById('target-qty').innerText = target;
    document.getElementById('actual-qty').innerText = machine.current_good_count;
    document.getElementById('ng-qty').innerText = machine.current_ng_count;
    
    // Update Production Chart and Hourly Totals
    updateProductionChart(machine);
}

async function simulateData() {
    // Simulate updating backend with new data
    const statuses = ['RUN', 'RUN', 'RUN', 'STOP', 'ALARM'];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    
    const actual = parseInt(document.getElementById('actual-qty').innerText) + Math.floor(Math.random() * 5);
    const ng = parseInt(document.getElementById('ng-qty').innerText) + (Math.random() > 0.8 ? 1 : 0);
    
    try {
        await fetch(`${API_BASE}/api/machine/AS001/update?status=${status}&good_qty=${actual}&ng_qty=${ng}`, { method: 'POST' });
        fetchData();
    } catch(e) {
        console.error(e);
    }
}

async function incrementActual() {
    const currentOk = parseInt(document.getElementById('actual-qty').innerText) || 0;
    const currentNg = parseInt(document.getElementById('ng-qty').innerText) || 0;
    const status = document.getElementById('machine-status-text').innerText || 'RUN';
    
    try {
        await fetch(`${API_BASE}/api/machine/AS001/update?status=${status}&good_qty=${currentOk + 1}&ng_qty=${currentNg}`, { method: 'POST' });
        fetchData();
    } catch(e) {
        console.error(e);
    }
}

async function setManualCounts() {
    const okInput = document.getElementById('manual-ok-input').value;
    const ngInput = document.getElementById('manual-ng-input').value;
    const status = document.getElementById('machine-status-text').innerText || 'RUN';
    
    // ถ้าช่องไหนว่าง ให้ใช้ค่าปัจจุบันที่มีอยู่ในหน้าจอ
    const ok = okInput === '' ? parseInt(document.getElementById('actual-qty').innerText) : parseInt(okInput);
    const ng = ngInput === '' ? parseInt(document.getElementById('ng-qty').innerText) : parseInt(ngInput);

    try {
        await fetch(`${API_BASE}/api/machine/AS001/update?status=${status}&good_qty=${ok}&ng_qty=${ng}`, { method: 'POST' });
        fetchData();
        // ล้างช่องกรอกข้อมูล
        document.getElementById('manual-ok-input').value = '';
        document.getElementById('manual-ng-input').value = '';
    } catch(e) {
        console.error(e);
    }
}

async function simulateAllMachines() {
    try {
        await fetch(`${API_BASE}/api/machines/simulate`, { method: 'POST' });
        fetchAllMachines(); // Fetch immediately to update UI
    } catch(e) {
        console.error(e);
    }
}

async function exportReport() {
    try {
        const res = await fetch(`${API_BASE}/api/report/export`);
        if(res.ok) {
            // Initiate download
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `AS001_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } else {
            alert("Export endpoint not implemented yet (Phase 3)");
        }
    } catch (e) {
        alert("Export endpoint not implemented yet (Phase 3)");
    }
}

// SPA Navigation
function switchView(viewId, element) {
    // Hide all views
    const views = document.querySelectorAll('.view-section');
    views.forEach(v => v.style.display = 'none');
    
    // Show selected view
    document.getElementById(viewId).style.display = 'block';
    
    // Update active nav item
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    
    // Update Page Title appropriately
    const titleMap = {
        'dashboard': 'AS001 Overview',
        'machines-overview': 'All Machines Overview',
        'alarms': 'Alarm History',
        'reports': 'Report Generator',
        'settings': 'System Settings'
    };
    document.querySelector('.page-title').innerText = titleMap[viewId] || 'AS001 Overview';
}

function updateProductionChart(machine) {
    if (!productionChart) return;

    const { shift } = getCurrentShiftInfo();
    const now = virtualTime || new Date();
    const currentHour = now.getHours();
    
    // Generate labels based on shift (08:20, 09:00, ..., 20:20)
    const labels = [];
    if (shift === 'day') {
        labels.push('08:20');
        for (let h = 9; h <= 20; h++) labels.push(h.toString().padStart(2, '0') + ':00');
        labels.push('20:20');
    } else {
        labels.push('20:20');
        for (let h = 21; h <= 23; h++) labels.push(h.toString().padStart(2, '0') + ':00');
        for (let h = 0; h <= 8; h++) labels.push(h.toString().padStart(2, '0') + ':00');
        labels.push('08:20');
    }

    // Update Chart Labels if changed
    if (JSON.stringify(productionChart.data.labels) !== JSON.stringify(labels)) {
        productionChart.data.labels = labels;
        // Reset data for new shift
        productionChart.data.datasets[0].data = new Array(labels.length).fill(0);
        productionChart.data.datasets[1].data = new Array(labels.length).fill(0);
        hourlyHistory = {}; 
    }

    // Track production in current hour slot
    const slotKey = currentHour.toString().padStart(2, '0') + ':00';
    // Map currentHour to label index
    let slotIndex = labels.indexOf(slotKey);
    // Handle the special :20 slots
    if (slotIndex === -1) {
        if (shift === 'day' && currentHour === 8) slotIndex = 0;
        else if (shift === 'day' && currentHour === 20) slotIndex = labels.length - 1;
        else if (shift === 'night' && currentHour === 20) slotIndex = 0;
        else if (shift === 'night' && currentHour === 8) slotIndex = labels.length - 1;
    }

    if (slotIndex !== -1) {
        if (!hourlyHistory[slotKey]) {
            hourlyHistory[slotKey] = { startGood: machine.current_good_count, startNG: machine.current_ng_count };
        }
        
        let goodInHour = machine.current_good_count - hourlyHistory[slotKey].startGood;
        let ngInHour = machine.current_ng_count - hourlyHistory[slotKey].startNG;

        // ป้องกันค่าติดลบกรณี reset counter หรือ refresh
        if (machine.current_good_count < hourlyHistory[slotKey].startGood) {
            goodInHour = machine.current_good_count;
        }

        if (machine.current_ng_count < hourlyHistory[slotKey].startNG) {
            ngInHour = machine.current_ng_count;
        }

        goodInHour = Math.max(0, goodInHour);
        ngInHour = Math.max(0, ngInHour);
        
        productionChart.data.datasets[0].data[slotIndex] = goodInHour;
        productionChart.data.datasets[1].data[slotIndex] = ngInHour;
        productionChart.update();

        saveHourlyHistory();
        saveChartData();

        // Update Hourly Totals Row
        const totalsRow = document.getElementById('hourly-totals-row');
        if (totalsRow) {
            const labelBox = `
                <div style="min-width: 40px; text-align: left; font-size: 0.7rem; color: var(--text-secondary); display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 2px;">
                    <div style="color: var(--success); font-weight: 800;">OK</div>
                    <div style="color: var(--danger); font-weight: 800;">NG</div>
                </div>
            `;
            totalsRow.innerHTML = labelBox + labels.map((label, idx) => {
                const ok = productionChart.data.datasets[0].data[idx] || 0;
                const ng = productionChart.data.datasets[1].data[idx] || 0;
                const active = idx === slotIndex;
                return `
                    <div style="flex: 1; text-align: center; font-size: 0.7rem; color: ${active ? 'var(--accent)' : 'var(--text-secondary)'}; font-weight: ${active ? '800' : '400'}">
                        <div style="margin-bottom: 2px; font-size: 0.6rem; opacity: 0.8;">${label}</div>
                        <div style="color: var(--success)">${ok}</div>
                        <div style="color: var(--danger)">${ng}</div>
                    </div>
                `;
            }).join('');
        }
    }
}

async function fetchAllMachines() {
    try {
        const res = await fetch(`${API_BASE}/api/machines`);
        let machines = await res.json();
        
        // Filter out AS001 (Line overview) and sort OP machines correctly
            machines = machines.filter(m =>
            m.name !== 'AS001' &&
            m.name !== 'OP3' &&
            m.name !== 'OP4' &&
            m.name !== 'OP6'
        );

        const opOrder = [
            "OP1",
            "OP2",
            "OP5",
            "OP7",
            "OP8",
            "OP9",
            "OP10",
            "OP11",
            "OP12",
            "OP13"
        ];

machines.sort((a, b) => {
    return opOrder.indexOf(a.name) - opOrder.indexOf(b.name);
});
        
        const grid = document.getElementById('machines-grid');
        if (!grid) return;
        grid.innerHTML = '';
        
        let run = 0, standby = 0, stop = 0;
        
        const { shift: currentShift, index: currentIndex } = getCurrentShiftInfo();

        machines.forEach(m => {
            if (!shiftHistory[m.name]) {
                shiftHistory[m.name] = { 
                    day: new Array(SHIFT_BLOCKS).fill(null), 
                    night: new Array(SHIFT_BLOCKS).fill(null) 
                };
            }
            if (currentIndex >= 0 && currentIndex < SHIFT_BLOCKS) {

                shiftHistory[m.name][currentShift][currentIndex] = m.status;

                saveTimelineToDB(
                    m.name,
                    currentShift,
                    currentIndex,
                    m.status
                );
            }

            saveShiftHistory();

            if (m.status === 'RUN') run++;
            else if (m.status === 'STANDBY') standby++;
            else stop++;

            let colorVar = 'var(--danger)';
            let pulseClass = 'stop';
            if (m.status === 'RUN') { colorVar = 'var(--success)'; pulseClass = 'run'; }
            else if (m.status === 'STANDBY') { colorVar = 'var(--warning)'; pulseClass = 'stop'; }
            else { colorVar = 'var(--danger)'; pulseClass = 'alarm'; }
            
            const renderBlocks = (shiftType) => {
                const blockPct = (100 / SHIFT_BLOCKS).toFixed(6) + '%';
                return shiftHistory[m.name][shiftType].map((status, i) => {
                    const isCurrent = (shiftType === currentShift && i === currentIndex);
                    const outerStyle = `flex: 0 0 ${blockPct}; height: 100%; display: flex; align-items: center; justify-content: center;`;

                    // inner fill width: STANDBY should be shorter (visual shortest), RUN/STOP full width
                    let innerWidth = '100%';
                    let innerBg = 'rgba(255,255,255,0.03)';
                    if (status === 'RUN') { innerBg = 'rgba(16, 185, 129, 0.8)'; innerWidth = '100%'; }
                    else if (status === 'STANDBY') { innerBg = 'rgba(245, 158, 11, 0.8)'; innerWidth = '60%'; }
                    else if (status === 'STOP' || status === 'ALARM') { innerBg = 'rgba(239, 68, 68, 0.8)'; innerWidth = '100%'; }

                    const innerShadow = isCurrent ? 'inset 0 0 0 2px white' : 'none';
                    return `<div style="${outerStyle}"><div style="width: ${innerWidth}; height: 84%; background: ${innerBg}; box-shadow: ${innerShadow}; border-radius: 4px;"></div></div>`;
                }).join('');
            };
            
            const card = document.createElement('div');
            card.className = 'card';
            card.style.background = 'transparent';
            card.style.border = 'none';
            card.style.padding = '0.8rem 1.2rem';
            card.style.marginBottom = '0.6rem';
            card.style.background = 'rgba(255,255,255,0.02)';
            card.style.borderRadius = '8px';
            card.style.border = '1px solid rgba(255,255,255,0.05)';
            
            const renderTimeScale = (shiftType) => {
                const labels = [];
                labels.push({ text: shiftType === 'day' ? '08:20' : '20:20', pos: 0 });
                for (let h = 0; h < 24; h += 2) {
                    const shiftStart = shiftType === 'day' ? 8*60+20 : 20*60+20;
                    const hMins = h * 60;
                    let diff = hMins - shiftStart;
                    if (diff < 0) diff += 24 * 60;
                    if (diff > 40 && diff < 680) { 
                        labels.push({ text: h.toString().padStart(2, '0') + ':00', pos: (diff / 720) * 100 });
                    }
                }
                labels.push({ text: shiftType === 'day' ? '20:20' : '08:20', pos: 100 });

                return labels.map(l => `
                    <span style="
                        position: absolute;
                        left: ${l.pos}%;
                        transform: ${l.pos === 0 ? 'translateX(0)' : l.pos === 100 ? 'translateX(-100%)' : 'translateX(-50%)'};
                        white-space: nowrap;
                    ">
                        ${l.text}
                    </span>
                `).join('');
            };
            
            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1.5rem; width: 100%;">
                    <!-- OP Name (Left) -->
                    <div style="width: 220px;font-weight: 900;font-size: 1.0rem;color: var(--accent);">
                            ${m.name} - ${machineDisplayNames[m.name] || ""}
                        </div>
                    
                    <!-- Timeline Area (Middle) -->
                        <div style="width: 1020px;min-width: 1020px;display: flex;flex-direction: column;gap: 5px;justify-content: center;margin-left: -80px;">
                        <!-- The Bar -->
                        <div style="display: grid; grid-template-columns: 45px 1fr; column-gap: 8px;">
                        <div>
                    </div>
                        <div style="height: 35px; display: flex; border-radius: 5px; overflow: hidden; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); box-shadow: inset 0 2px 5px rgba(0,0,0,0.5); width: 100%;">
                            ${renderBlocks(currentShift)}
                        </div>
                    </div>
                        
                        <!-- Day Scale with Label -->
                        <div style="display: grid; grid-template-columns: 70px 1fr; column-gap: 8px; padding-left: 0;">
                            <div style="font-size: 0.55rem; font-weight: 900; color: ${currentShift === 'day' ? 'var(--accent)' : 'var(--text-secondary)'}; text-align: right;">DAY</div>
                            <div style="position: relative; height: 14px; font-size: 0.6rem; color: ${currentShift === 'day' ? 'var(--accent)' : 'var(--text-secondary)'}; font-weight: 700;">
                                ${renderTimeScale('day')}
                            </div>
                        </div>

                        <!-- Night Scale with Label -->
                        <div style="display: grid; grid-template-columns: 70px 1fr; column-gap: 8px; padding-left: 0;">
                            <div style="font-size: 0.55rem; font-weight: 900; color: ${currentShift === 'night' ? 'var(--accent)' : 'var(--text-secondary)'}; text-align: right;">NIGHT</div>
                            <div style="position: relative; height: 14px; font-size: 0.6rem; color: ${currentShift === 'night' ? 'var(--accent)' : 'var(--text-secondary)'}; font-weight: 700;">
                                ${renderTimeScale('night')}
                            </div>
                        </div>
                    </div>

                    <!-- Status (Right) with controls -->
                    <div style="min-width: 180px; display: flex; align-items: center; gap: 0.8rem; justify-content: flex-end; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 1rem;">
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span class="pulse-dot ${pulseClass}" style="background-color: ${colorVar}; width: 12px; height: 12px;"></span>
                                <span style="color: ${colorVar}; font-weight: 900; font-size: 1.1rem; letter-spacing: 1px;">${m.status}</span>
                            </div>
                            <div style="display:flex; gap:6px;" class="op-controls">
                                <button class="mini-btn mini-run" onclick="runMachine('${m.name}')">RUN</button>
                                <button class="mini-btn mini-standby" onclick="changeMachineStatus('${m.name}','STANDBY')">STANDBY</button>
                                <button class="mini-btn mini-stop" onclick="changeMachineStatus('${m.name}','STOP')">STOP</button>
                                <button class="mini-btn mini-alarm" onclick="triggerAlarm('${m.name}')">ALARM</button>
                                <button class="mini-btn mini-reset" onclick="resetAlarm('${m.name}')">RESET</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
        
        document.getElementById('count-run').innerText = run;
        document.getElementById('count-standby').innerText = standby;
        document.getElementById('count-stop').innerText = stop;
        
    } catch (e) {
        console.error("Error fetching all machines:", e);
    }
}

// --- Current Date/Time display (top-right) ---
function updateCurrentDatetime() {
    const el = document.getElementById('current-datetime');
    if (!el) return;
    const now = virtualTime || new Date();
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).formatToParts(now);

        const map = {};
        parts.forEach(p => { if (p.type && p.type !== 'literal') map[p.type] = p.value; });

        const weekday = map.weekday || '';
        const day = map.day || '';
        const month = map.month || '';
        const year = map.year || '';
        const hour = map.hour || '00';
        const minute = map.minute || '00';
        const second = map.second || '00';

        el.textContent = `${weekday}, ${day} ${month} ${year}, ${hour}:${minute}:${second}`;
    } catch (e) {
        const s = (virtualTime || new Date()).toLocaleString('en-GB');
        el.textContent = `(${s.replace(/:/g, '.')})`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateCurrentDatetime();
    setInterval(updateCurrentDatetime, 1000);
});

const machineOPMap = {
  OP1: [
    "Plug bleeder tightening & Mark lot No.",
  ],
  OP2: [
    "Seat union press in",
  ],
  OP5: [
    "Piston press in & Through hole check"
  ],
  OP7: [
    "Bolt tightening No.1"
  ],
  OP8: [
    "Bolt tightening No.2"
  ],
  OP9: [
    "Low leak test"
  ],
  OP10: [
    "High pressure load"
  ],
  OP11: [
    "Med leak test No.1"
  ],
  OP12: [
    "Med leak test No.2"
  ],
  OP13: [
    "Pad assembly"
  ]
};

// ==========================
// Alarm System From DB
// ==========================

let selectedOP = "ALL";
let alarmData = [];

function selectOP(op) {
    selectedOP = op;

    document.querySelectorAll(".op-buttons button").forEach(btn => {
        btn.classList.remove("active");
    });

    if (event && event.target) {
        event.target.classList.add("active");
    }

    loadAlarms();
}

async function loadAlarmsFromDB() {
    try {
        const res = await fetch(`${API_BASE}/api/alarms`);
        alarmData = await res.json();
        loadAlarms();
    } catch (error) {
        console.error("Load alarms error:", error);
    }
}

async function triggerAlarm(machineName) {
    const opName = machineName.split(" ")[0];

    await fetch(`${API_BASE}/api/alarms`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            op_name: opName,
            station_name: machineName,
            message: "Machine Alarm"
        })
    });

    await changeMachineStatus(machineName, "ALARM");
    await loadAlarmsFromDB();
}

async function resetAlarm(machineName) {
    await fetch(`${API_BASE}/api/alarms/${encodeURIComponent(machineName)}/reset`, {
        method: "POST"
    });

    await changeMachineStatus(machineName, "STOP");
    await loadAlarmsFromDB();
}

async function runMachine(machineName) {
    await fetch(`${API_BASE}/api/alarms/${encodeURIComponent(machineName)}/run`, {
        method: "POST"
    });

    await changeMachineStatus(machineName, "RUN");
    await loadAlarmsFromDB();
}

function loadAlarms() {
    const tbody = document.getElementById("alarmTableBody");
    if (!tbody) return;

    let filteredData = alarmData;

    if (selectedOP !== "ALL") {
        filteredData = alarmData.filter(row => row.op_name === selectedOP);
    }

    tbody.innerHTML = "";

    filteredData.forEach(row => {
        tbody.innerHTML += `
            <tr>
                <td>${row.station_name || ""}</td>
                <td>${row.message || ""}</td>
                <td>${row.count || ""}</td>
                <td>${formatAlarmTime(row.occured_time)}</td>
                <td>${formatAlarmTime(row.cleared_time)}</td>
                <td>${formatAlarmTime(row.start_time)}</td>
                <td>${row.reset_time || ""}</td>
                <td>${row.recovery_time || ""}</td>
            </tr>
        `;
    });
}

function formatAlarmTime(value) {
    if (!value) return "";

    return new Date(value).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
}