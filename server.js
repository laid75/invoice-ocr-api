const express = require('express');
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const upload = multer({ dest: 'uploads/' });
const CREDITS_FILE = path.join(__dirname, 'credits.json');

// دالة لقراءة أرصدة المستخدمين من ملف الـ JSON
function getCreditsData() {
    if (!fs.existsSync(CREDITS_FILE)) {
        fs.writeFileSync(CREDITS_FILE, JSON.stringify({}));
    }
    const data = fs.readFileSync(CREDITS_FILE, 'utf8');
    try {
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

// دالة لحفظ الأرصدة في الملف
function saveCreditsData(data) {
    fs.writeFileSync(CREDITS_FILE, JSON.stringify(data, null, 2));
}

// دالة تحليل النص لاستخراج العناصر والأسعار
function parseInvoiceText(text) {
    const items = [];
    const lines = text.split('\n');

    for (let line of lines) {
        const priceMatch = line.match(/([0-9][0-9.,]*)\s*(?:دج|DA|DA\.|DZD)/i);
        
        if (priceMatch) {
            const itemName = line.replace(priceMatch[0], '').trim();
            if (itemName.length > 2) {
                items.push({
                    item_name: itemName,
                    price: priceMatch[1] + " دج"
                });
            }
        }
    }

    return {
        total_items_found: items.length,
        items_list: items
    };
}

// 1. واجهة المستخدم البسيطة (Frontend HTML)
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>مستخرج بيانات الفواتير الذكي</title>
            <style>
                body { font-family: Tahoma, sans-serif; background-color: #f4f7f6; margin: 0; padding: 50px; text-align: center; }
                .container { background: white; max-width: 600px; margin: auto; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                h2 { color: #333; }
                input[type="file"] { margin: 20px 0; padding: 10px; border: 1px solid #ddd; border-radius: 6px; width: 80%; }
                button { background: #007bff; color: white; border: none; padding: 12px 25px; font-size: 16px; border-radius: 6px; cursor: pointer; }
                button:hover { background: #0056b3; }
                #result { margin-top: 25px; text-align: left; direction: ltr; background: #f8f9fa; padding: 15px; border-radius: 6px; display: none; white-space: pre-wrap; font-family: monospace; }
                .loading { color: #007bff; display: none; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>استخراج بيانات الفواتير بضغطة زر</h2>
                <p>لديك رصيد مجاني لاستخراج الفواتير. ارفع صورة الفاتورة وسيقوم النظام بقراءتها تلقائياً.</p>
                
                <input type="file" id="invoiceFile" accept="image/*"><br>
                <button onclick="uploadInvoice()">استخراج البيانات</button>
                
                <div class="loading" id="loadingText">جاري قراءة الفاتورة وتحليلها، يرجى الانتظار...</div>
                <div id="result"></div>
            </div>

            <script>
                async function uploadInvoice() {
                    const fileInput = document.getElementById('invoiceFile');
                    const resultDiv = document.getElementById('result');
                    const loadingText = document.getElementById('loadingText');

                    if (fileInput.files.length === 0) {
                        alert('الرجاء اختيار صورة فاتورة أولاً.');
                        return;
                    }

                    const formData = new FormData();
                    formData.append('invoice', fileInput.files[0]);

                    loadingText.style.display = 'block';
                    resultDiv.style.display = 'none';

                    try {
                        const response = await fetch('/api/v1/extract-invoice', {
                            method: 'POST',
                            body: formData
                        });

                        const result = await response.json();
                        loadingText.style.display = 'none';
                        resultDiv.style.display = 'block';

                        if (result.success) {
                            resultDiv.innerHTML = JSON.stringify(result.data, null, 4) + "\\n\\n[المتبقي من رصيدك المجاني: " + result.remaining_credits + " فواتير]";
                        } else {
                            resultDiv.innerHTML = 'حدث خطأ: ' + result.error;
                        }
                    } catch (error) {
                        loadingText.style.display = 'none';
                        resultDiv.style.display = 'block';
                        resultDiv.innerHTML = 'حدث خطأ في الاتصال بالخادم.';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// 2. نقطة النهاية للـ API مع التحقق والخصم عبر الـ JSON
app.post('/api/v1/extract-invoice', upload.single('invoice'), async (req, res) => {
    let imagePath = null;
    const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';

    let creditsData = getCreditsData();

    // إذا كان المستخدم جديداً، امنحه 10 فواتير مجانية
    if (creditsData[clientIp] === undefined) {
        creditsData[clientIp] = 10;
    }

    let currentCredits = creditsData[clientIp];

    // التحقق من نفاد الرصيد
    if (currentCredits <= 0) {
        if (req.file && req.file.path) fs.unlinkSync(req.file.path);
        return res.status(403).json({ 
            success: false, 
            error: 'لقد استنفذت رصيدك المجاني بالكامل! يرجى الترقية للحصول على رصيد إضافي.' 
        });
    }

    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'الرجاء إرفاق صورة الفاتورة.' });
        }

        imagePath = req.file.path;

        const worker = await createWorker(['ara', 'fra', 'eng']);
        const ret = await worker.recognize(imagePath);
        const extractedText = ret.data.text;
        await worker.terminate();

        const structuredData = parseInvoiceText(extractedText);

        // خصم رصيد و حفظه في الملف
        creditsData[clientIp] -= 1;
        saveCreditsData(creditsData);

        res.json({
            success: true,
            message: 'تم استخراج البيانات بنجاح',
            remaining_credits: creditsData[clientIp],
            data: {
                extracted_fields: structuredData,
                raw_text: extractedText
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'حدث خطأ أثناء معالجة الصورة.' });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web App is running on http://localhost:${PORT}`);
});