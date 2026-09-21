const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

const app = express();
const port = process.env.PORT || 3000;

// إعدادات التخزين المؤقت للصور
const upload = multer({ dest: 'uploads/' });

// مسار ملف البيانات
const CREDITS_FILE = path.join(__dirname, 'credits.json');

// دالة لقراءة بيانات الأرصدة والسريالات من ملف JSON
function getData() {
    if (!fs.existsSync(CREDITS_FILE)) {
        const initialData = {
            api_keys: {},
            serial_keys: {
                "WELCOME-50-FREE": { "credits": 50, "used": false },
                "PRO-UPGRADE-200": { "credits": 200, "used": false }
            }
        };
        fs.writeFileSync(CREDITS_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    const data = fs.readFileSync(CREDITS_FILE, 'utf8');
    try {
        const parsed = JSON.parse(data);
        // توافقية مع النسخ القديمة إذا كانت البنية بسيطة
        if (!parsed.api_keys) {
            return { api_keys: parsed, serial_keys: { "WELCOME-50-FREE": { "credits": 50, "used": false } } };
        }
        return parsed;
    } catch (err) {
        return { api_keys: {}, serial_keys: {} };
    }
}

// دالة لحفظ البيانات في ملف JSON
function saveData(data) {
    fs.writeFileSync(CREDITS_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json());

// 1. مسار معالجة الفواتير (OCR) واستهلاك الرصيد
app.post('/api/process-invoice', upload.single('invoice'), async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey) {
        return res.status(401).json({ error: 'API Key is missing' });
    }

    const db = getData();

    if (!db.api_keys[apiKey] || db.api_keys[apiKey] <= 0) {
        return res.status(403).json({ error: 'Insufficient credits or invalid API key' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No invoice image uploaded' });
    }

    const filePath = req.file.path;

    try {
        const worker = await createWorker(['ara', 'fra', 'eng']);
        const ret = await worker.recognize(filePath);
        await worker.terminate();

        // خصم نقطة واحدة بعد النجاح
        db.api_keys[apiKey] -= 1;
        saveData(db);

        fs.unlinkSync(filePath);

        res.json({
            success: true,
            remaining_credits: db.api_keys[apiKey],
            extracted_text: ret.data.text
        });

    } catch (error) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ error: 'OCR processing failed', details: error.message });
    }
});

// 2. مسار إدخال سريال الترقية وشحن الرصيد
app.post('/api/activate-serial', (req, res) => {
    const { api_key, serial } = req.body;

    if (!api_key || !serial) {
        return res.status(400).json({ error: 'API key and serial code are required' });
    }

    const db = getData();

    // التحقق من وجود السريال وهل تم استخدامه من قبل أم لا
    if (!db.serial_keys[serial]) {
        return res.status(404).json({ error: 'Invalid serial number' });
    }

    if (db.serial_keys[serial].used) {
        return res.status(400).json({ error: 'This serial number has already been used' });
    }

    // إضافة أو تفعيل الـ API Key إذا لم يكن موجوداً
    if (!db.api_keys[api_key]) {
        db.api_keys[api_key] = 0;
    }

    // شحن الرصيد المضاف من السريال
    const addedCredits = db.serial_keys[serial].credits;
    db.api_keys[api_key] += addedCredits;

    // تعليم السريال أنه تم استخدامه حتى لا يُعاد استخدامه
    db.serial_keys[serial].used = true;

    // حفظ التغييرات في ملف JSON
    saveData(db);

    res.json({
        success: true,
        message: `Successfully upgraded! Added ${addedCredits} credits.`,
        new_balance: db.api_keys[api_key]
    });
});

app.get('/', (req, res) => {
    res.send('Invoice OCR API with Serial Upgrades is running!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});