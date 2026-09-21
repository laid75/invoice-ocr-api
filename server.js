const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

const app = express();
const port = process.env.PORT || 3000;

// إعدادات التخزين لـ Multer لرفع الصور مؤقتاً
const upload = multer({ dest: 'uploads/' });

// مسار ملف تخزين الأرصدة
const CREDITS_FILE = path.join(__dirname, 'credits.json');

// دالة لقراءة الأرصدة من ملف JSON
function getCreditsData() {
    if (!fs.existsSync(CREDITS_FILE)) {
        // إذا لم يكن الملف موجوداً، ننشئ بنية افتراضية
        const initialData = {};
        fs.writeFileSync(CREDITS_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    const data = fs.readFileSync(CREDITS_FILE, 'utf8');
    try {
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
}

// دالة لحفظ الأرصدة في ملف JSON
function saveCreditsData(data) {
    fs.writeFileSync(CREDITS_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json());

// مسار فحص الرصيد أو استهلاكه
app.post('/api/process-invoice', upload.single('invoice'), async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey) {
        return res.status(401).json({ error: 'API Key is missing' });
    }

    const creditsData = getCreditsData();

    // التحقق مما إذا كان المفتاح موجوداً ولديه رصيد
    if (!creditsData[apiKey] || creditsData[apiKey] <= 0) {
        return res.status(403).json({ error: 'Insufficient credits or invalid API key' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No invoice image uploaded' });
    }

    const filePath = req.file.path;

    try {
        // تهيئة Tesseract.js لقراءة اللغات (عربي، فرنسي، إنجليزي)
        const worker = await createWorker(['ara', 'fra', 'eng']);
        
        const ret = await worker.recognize(filePath);
        await worker.terminate();

        // خصم رصيد واحد بعد النجاح
        creditsData[apiKey] -= 1;
        saveCreditsData(creditsData);

        // حذف الصورة المؤقتها
        fs.unlinkSync(filePath);

        res.json({
            success: true,
            remaining_credits: creditsData[apiKey],
            extracted_text: ret.data.text
        });

    } catch (error) {
        // حذف الصورة في حال حدوث خطأ
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ error: 'OCR processing failed', details: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('Invoice OCR API with JSON Credits is running!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});