const express = require('express');
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

const upload = multer({ dest: 'uploads/' });

// دالة تحليل متقدمة لاستخراج جميع العناصر والأسعار من النص
function parseInvoiceText(text) {
    const items = [];
    const lines = text.split('\n');

    for (let line of lines) {
        // البحث عن أي سعر يسبقه أو يتبعه العملة أو أرقام الأسعار
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

// 1. واجهة المستخدم البسيطة (Frontend HTML) عند الدخول للموقع مباشرة
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
                <p>ارفع صورة الفاتورة (أو ملف PDF) وسيقوم النظام بقراءتها واستخراج البيانات تلقائياً.</p>
                
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
                            resultDiv.innerHTML = JSON.stringify(result.data, null, 4);
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

// 2. نقطة النهاية للـ API (التي تستقبل الصورة وتعالجها)
app.post('/api/v1/extract-invoice', upload.single('invoice'), async (req, res) => {
    let imagePath = null;
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

        res.json({
            success: true,
            message: 'تم استخراج البيانات بنجاح',
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