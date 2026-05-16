import { Link } from "react-router-dom";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";

const TermsPage = () => (
  <div className="flex min-h-screen flex-col bg-background">
    <Seo
      title="Terms of Service | AirMileX"
      description="The Terms of Service governing your use of AirMileX, available in English and Turkish."
      path="/terms-and-conditions"
    />
    <main className="flex-1 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to Home</Link>

        <h1 className="mt-6 text-3xl font-bold mb-8">TERMS OF SERVICE / HİZMET ŞARTLARI</h1>

        {/* Turkish */}
        <h2 className="text-2xl font-bold mb-4">Türkçe</h2>
        <p className="mb-1 text-sm text-muted-foreground">Son Güncelleme: 10/04/2026</p>
        <p className="mb-4 text-sm text-muted-foreground">Yürürlük Tarihi: 10/04/2026</p>
        <p className="mb-4 text-muted-foreground">Bu Hizmet Şartları ("Şartlar"), Eren Tahiroğlu tarafından AirMileX markası altında sunulan web sitesi, web uygulaması ve ilgili hizmetlerin kullanımını düzenler. AirMileX'e erişerek, hesap oluşturarak veya ücretli ya da ücretsiz kullanım başlatarak bu Şartları kabul etmiş olursunuz.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">1. Hizmet Sağlayıcı</h3>
        <p className="mb-4 text-muted-foreground">Bu Şartlar kapsamındaki hizmet sağlayıcı:<br/>Eren Tahiroğlu<br/>AirMileX markası altında bireysel satıcı<br/>E-posta: erentahiroglu@hotmail.com.tr<br/>Yazışma Adresi: Abdullah Gül Üniversitesi Öğrenci Yurtları, Yeni, 4. Sk. No:8, 38090 Kocasinan/Kayseri, Türkiye</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">2. Hizmetin Tanımı</h3>
        <p className="mb-4 text-muted-foreground">AirMileX, kullanıcıların kilometre/mesafe takibi yapmasına, Airtable bağlamasına, sürüş mesafelerini hesaplamasına ve yapılandırılmış raporlar oluşturmasına yardımcı olan web tabanlı bir yazılım hizmetidir. AirMileX; hukuk, vergi, muhasebe, bordro veya resmi mevzuat uyum danışmanlığı vermez. AirMileX üzerinden üretilen kayıtların, raporların veya hesaplamaların kendi kullanım amacınıza ve tabi olduğunuz kurallara uygunluğunu kontrol etmek sizin sorumluluğunuzdadır.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">3. Uygunluk</h3>
        <p className="mb-4 text-muted-foreground">AirMileX'i kullanabilmek için en az 18 yaşında olmanız ve bağlayıcı bir sözleşme yapma ehliyetine sahip olmanız gerekir. Bir işletme veya kuruluş adına işlem yapıyorsanız, o kuruluşu bağlama yetkiniz olduğunu beyan edersiniz.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">4. Hesap ve Güvenlik</h3>
        <p className="mb-2 text-muted-foreground">Bazı özellikler için hesap oluşturmanız gerekir. Hesap bilgilerinizin doğru, güncel ve eksiksiz olması gerekir. Şunlardan siz sorumlusunuz:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>giriş bilgilerinizin gizliliği,</li>
          <li>hesabınız altındaki tüm faaliyetler,</li>
          <li>yetkisiz kullanım veya güvenlik ihlali şüphesini gecikmeden bildirmek.</li>
        </ul>
        <p className="mb-4 text-muted-foreground">Hukuka aykırı kullanım, kötüye kullanım, dolandırıcılık şüphesi veya bu Şartların ihlali halinde hesabı askıya alma veya erişimi sonlandırma hakkımız saklıdır.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">5. Planlar, Fiyatlandırma ve Yenileme</h3>
        <p className="mb-2 text-muted-foreground">AirMileX aylık abonelik modeliyle sunulabilir. Ücretsiz veya sınırlı kullanım varsa, bu kapsam ve limitler fiyatlandırma sayfasında veya ürün içinde ayrıca belirtilir. Aksi açıkça belirtilmedikçe:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>ücretli planlar peşin tahsil edilir,</li>
          <li>abonelikler otomatik yenilenir,</li>
          <li>siz iptal etmedikçe sonraki dönem için yeniden ücretlendirilirsiniz.</li>
        </ul>
        <p className="mb-4 text-muted-foreground">Fiyat, vergi ve plan kapsamı satın alma sırasında gösterilen bilgilere göre belirlenir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">6. Paddle ve Ödeme İşlemleri</h3>
        <p className="mb-2 text-muted-foreground">AirMileX ödemeleri Paddle üzerinden işlenir. Paddle, ilgili işlem bakımından Merchant of Record olarak hareket edebilir. Bu nedenle checkout, ödeme işleme, vergi tahsili, bazı refund işlemleri ve belirli alıcı destek süreçleri Paddle üzerinden yürütülebilir. Bu nedenle:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>hizmetin kullanımı bu Şartlara,</li>
          <li>checkout, ödeme, faturalandırma ve bazı iade süreçleri ise ayrıca Paddle'ın ilgili şartlarına ve uygulanabilir zorunlu mevzuata tabi olabilir.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">7. Abonelik İptali</h3>
        <p className="mb-4 text-muted-foreground">Aboneliğinizi istediğiniz zaman iptal edebilirsiniz. İptal, aksi zorunlu hukuk kuralı bulunmadıkça, mevcut faturalama döneminin sonunda hüküm doğurur. İptal sonrası yeni dönem için ücret alınmaz. Mevcut dönem için ödenen tutar ise otomatik olarak iade edilmez; iade şartları ayrıca İade Politikası'nda düzenlenir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">8. İade</h3>
        <p className="mb-4 text-muted-foreground">İade koşulları ayrı bir Refund Policy / İade Politikası metninde düzenlenir. AirMileX, ticari politika olarak belirli şartlarda 30 günlük money-back guarantee sunabilir. Bu ticari politika, uygulanabilir zorunlu tüketici haklarını ortadan kaldırmaz veya daraltmaz.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">9. Kullanıcı Verileri</h3>
        <p className="mb-2 text-muted-foreground">AirMileX'e yüklediğiniz, senkronize ettiğiniz veya manuel olarak girdiğiniz veriler sizin sorumluluğunuzdadır. Buna Airtable üzerinden getirilen veriler, adresler, rota verileri, mesafe kayıtları, notlar ve diğer içerikler dahildir. Bu verileri işlemek, saklamak, göstermek, dışa aktarmak ve size hizmet sunmak amacıyla kullanabilmemiz için bize hizmetle sınırlı bir kullanım yetkisi verirsiniz. Şunu beyan edersiniz:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>yüklediğiniz veya bağladığınız veriler üzerinde gerekli haklara sahipsiniz,</li>
          <li>üçüncü kişilere ait verileri hukuka uygun şekilde işliyorsunuz,</li>
          <li>AirMileX'i sahte, yanıltıcı veya hileli kayıt üretmek için kullanmayacaksınız.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">10. Üçüncü Taraf Hizmetler ve API Anahtarları</h3>
        <p className="mb-2 text-muted-foreground">AirMileX; Airtable ve harita/mesafe servisleri gibi üçüncü taraf sistemlerle entegre çalışabilir. Kendi API anahtarlarınızı kullanmanız halinde:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>bu anahtarların güvenliği size aittir,</li>
          <li>ilgili servislerin ücretleri, limitleri ve kullanım şartları size aittir,</li>
          <li>üçüncü taraf servis kaynaklı kesinti, kota aşımı veya veri hatalarından doğrudan sorumlu değiliz.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">11. Yasaklı Kullanımlar</h3>
        <p className="mb-2 text-muted-foreground">AirMileX şu amaçlarla kullanılamaz:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>hukuka aykırı faaliyetler,</li>
          <li>yetkisiz erişim girişimleri,</li>
          <li>güvenlik ihlali yaratmak,</li>
          <li>zararlı yazılım yüklemek,</li>
          <li>hileli kilometre veya reimbursement kaydı üretmek,</li>
          <li>hizmeti izinsiz kopyalamak, tersine mühendislik yapmak veya rekabetçi ürün geliştirmek,</li>
          <li>başkalarının verilerini yetkisiz işlemek.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">12. Fikri Mülkiyet</h3>
        <p className="mb-4 text-muted-foreground">AirMileX yazılımı, arayüzü, markası, tasarımı ve ilgili tüm fikri mülkiyet hakları Eren Tahiroğlu'na ve/veya ilgili lisans sahiplerine aittir. Bu Şartlar size yalnızca sınırlı, devredilemez ve geri alınabilir bir kullanım hakkı verir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">13. Hizmetin Sürekliliği</h3>
        <p className="mb-4 text-muted-foreground">AirMileX'i geliştirme, değiştirme, kısmen askıya alma veya belirli özellikleri kaldırma hakkımız saklıdır. Hizmetin her zaman kesintisiz, hatasız veya her ortamda aynı şekilde çalışacağı garanti edilmez.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">14. Sorumluluk Reddi</h3>
        <p className="mb-4 text-muted-foreground">AirMileX "olduğu gibi" ve "mevcut olduğu ölçüde" sunulur. Rota, mesafe, adres, senkronizasyon ve raporlama çıktıları; kullanıcı girdilerine, Airtable verilerine, üçüncü taraf servislerine ve bağlantı durumuna bağlı olarak değişebilir. Çıktıların son kontrolü ve doğrulanması kullanıcıya aittir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">15. Sorumluluğun Sınırlandırılması</h3>
        <p className="mb-4 text-muted-foreground">Uygulanabilir zorunlu hukukun izin verdiği azami ölçüde, AirMileX ile ilgili toplam sorumluluğumuz, talebe konu olaydan önceki son 12 ayda ilgili kullanıcı tarafından AirMileX için fiilen ödenen toplam tutarla sınırlıdır. Dolaylı zararlar, kâr kaybı, veri kaybı, iş kaybı, itibar kaybı veya üçüncü taraf kaynaklı zararlar bakımından, zorunlu hukuk aksini gerektirmedikçe sorumluluk kabul edilmez. Bu madde; vazgeçilemeyen tüketici haklarını, dolandırıcılığı, kasıtlı kötü niyeti veya hukuken sınırlandırılamayan sorumlulukları ortadan kaldırmaz.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">16. Fesih</h3>
        <p className="mb-4 text-muted-foreground">Bu Şartları ihlal etmeniz, AirMileX'i kötüye kullanmanız veya hukuki, güvenlik ya da operasyonel risk yaratmanız halinde erişiminiz askıya alınabilir veya sonlandırılabilir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">17. Şikayetler</h3>
        <p className="mb-4 text-muted-foreground">Şikayetlerinizi erentahiroglu@hotmail.com.tr adresine iletebilirsiniz. Makul ölçüde 5 iş günü içinde ilk yanıt, 15 iş günü içinde esaslı değerlendirme hedeflenir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">18. Uygulanacak Hukuk ve Uyuşmazlık</h3>
        <p className="mb-4 text-muted-foreground">Bu Şartlar, zorunlu tüketici hukuku hükümleri saklı kalmak üzere, Türkiye Cumhuriyeti hukuku uyarınca yorumlanır. Ödeme, checkout ve bazı iade süreçleri bakımından Paddle'ın ilgili alıcı şartları da ayrıca uygulanabilir. Tüketici sıfatını haiz kullanıcılar bakımından, uygulanabilir zorunlu mevzuattan doğan başvuru ve yetki hakları saklıdır. Türkiye'de bulunan tüketiciler, şartları oluştuğunda Tüketici Hakem Heyeti veya Tüketici Mahkemesi'ne başvurabilir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">19. Değişiklikler</h3>
        <p className="mb-4 text-muted-foreground">Bu Şartlar zaman zaman güncellenebilir. Güncel metin web sitesinde yayımlandığı anda yürürlüğe girer.</p>

        <hr className="my-10 border-border" />

        {/* English */}
        <h2 className="text-2xl font-bold mb-4">English</h2>
        <p className="mb-1 text-sm text-muted-foreground">Last Updated: 10/04/2026</p>
        <p className="mb-4 text-sm text-muted-foreground">Effective Date: 10/04/2026</p>
        <p className="mb-4 text-muted-foreground">These Terms of Service ("Terms") govern the use of the AirMileX website, web application, and related services provided by Eren Tahiroğlu, operating as an individual seller under the AirMileX brand. By accessing AirMileX, creating an account, or using any paid or free feature, you agree to these Terms.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">1. Service Provider</h3>
        <p className="mb-4 text-muted-foreground">Eren Tahiroğlu<br/>Individual seller operating under the AirMileX brand<br/>Email: erentahiroglu@hotmail.com.tr<br/>Correspondence Address: Abdullah Gül Üniversitesi Öğrenci Yurtları, Yeni, 4. Sk. No:8, 38090 Kocasinan/Kayseri, Türkiye</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">2. Description of the Service</h3>
        <p className="mb-4 text-muted-foreground">AirMileX is a web-based software service designed to help users track mileage, connect Airtable, calculate driving distances, and generate structured reports. AirMileX is not a law firm, tax adviser, accountant, payroll provider, or compliance advisory service. You are responsible for verifying whether any output, record, calculation, or report generated through AirMileX is suitable for your legal, tax, accounting, reimbursement, or operational needs.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">3. Eligibility</h3>
        <p className="mb-4 text-muted-foreground">You must be at least 18 years old and legally capable of entering into a binding contract. If you use AirMileX on behalf of a business or organization, you represent that you are authorized to bind that entity.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">4. Accounts and Security</h3>
        <p className="mb-2 text-muted-foreground">Some features require an account. You agree to provide accurate, current, and complete information. You are responsible for:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>protecting your login credentials,</li>
          <li>all activity under your account,</li>
          <li>promptly notifying us of unauthorized use or suspected security issues.</li>
        </ul>
        <p className="mb-4 text-muted-foreground">We may suspend or terminate accounts involved in unlawful conduct, abuse, fraud, or breaches of these Terms.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">5. Plans, Pricing, and Renewal</h3>
        <p className="mb-2 text-muted-foreground">AirMileX may be offered on a monthly subscription basis. Any free access or limited usage allowances will be described on the pricing page or within the product. Unless stated otherwise:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>paid plans are billed in advance,</li>
          <li>subscriptions renew automatically,</li>
          <li>charges continue until cancellation.</li>
        </ul>
        <p className="mb-4 text-muted-foreground">Pricing, taxes, and plan scope are determined by the information shown at the time of purchase.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">6. Paddle and Payments</h3>
        <p className="mb-2 text-muted-foreground">Payments for AirMileX are processed through Paddle. Paddle may act as the Merchant of Record for the relevant transaction. As a result, checkout, payment processing, tax handling, certain refund workflows, and parts of buyer support may be handled through Paddle. Accordingly:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>use of the software service is governed by these Terms,</li>
          <li>checkout, billing, payment, and certain refund matters may also be subject to Paddle's applicable buyer terms and mandatory law.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">7. Cancellation</h3>
        <p className="mb-4 text-muted-foreground">You may cancel your subscription at any time. Unless mandatory law requires otherwise, cancellation takes effect at the end of the current billing period. No future billing will occur after cancellation. Amounts already paid for the current billing period are not automatically refunded; refund terms are set out separately in the Refund Policy.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">8. Refunds</h3>
        <p className="mb-4 text-muted-foreground">Refund rules are set out separately in the Refund Policy. As a commercial policy, AirMileX may offer a 30-day money-back guarantee under the conditions described there. This commercial policy does not limit any mandatory consumer rights under applicable law.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">9. User Data</h3>
        <p className="mb-2 text-muted-foreground">You are responsible for the data you upload, sync, or manually enter into AirMileX, including Airtable data, addresses, route information, mileage records, notes, and other content. You grant us a limited right to process, store, display, export, and use that data solely to provide and operate the service. You represent that:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>you have the necessary rights to use and submit the data,</li>
          <li>any personal data of third parties is handled lawfully,</li>
          <li>you will not use AirMileX to create false, misleading, or fraudulent records.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">10. Third-Party Services and API Keys</h3>
        <p className="mb-2 text-muted-foreground">AirMileX may integrate with third-party services such as Airtable and mapping or distance providers. If you use your own API keys:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>you are responsible for keeping them secure,</li>
          <li>you are responsible for any third-party fees, limits, and contractual terms,</li>
          <li>we are not directly responsible for outages, quota failures, or data errors caused by those third parties.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">11. Prohibited Uses</h3>
        <p className="mb-2 text-muted-foreground">You may not use AirMileX to:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>violate the law,</li>
          <li>attempt unauthorized access,</li>
          <li>disrupt system security,</li>
          <li>upload malicious code,</li>
          <li>generate fraudulent mileage or reimbursement data,</li>
          <li>reverse engineer or copy the service without authorization,</li>
          <li>unlawfully process other people's data.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">12. Intellectual Property</h3>
        <p className="mb-4 text-muted-foreground">AirMileX, including its software, interface, branding, design, and related intellectual property, is owned by Eren Tahiroğlu and/or relevant licensors. These Terms grant only a limited, revocable, non-transferable right to use the service.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">13. Availability</h3>
        <p className="mb-4 text-muted-foreground">We may improve, modify, suspend, or remove parts of AirMileX at any time. We do not guarantee uninterrupted, error-free, or identical operation across all environments.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">14. Disclaimer</h3>
        <p className="mb-4 text-muted-foreground">AirMileX is provided on an "as is" and "as available" basis. Route, distance, address, synchronization, and reporting outputs may vary depending on user input, Airtable data, third-party services, and connectivity. Final review and verification of outputs remains your responsibility.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">15. Limitation of Liability</h3>
        <p className="mb-4 text-muted-foreground">To the maximum extent permitted by mandatory law, our total liability relating to AirMileX will be limited to the total amount actually paid by the relevant user for AirMileX during the 12 months preceding the event giving rise to the claim. We are not liable, except where mandatory law provides otherwise, for indirect losses, loss of profit, loss of data, business interruption, reputational damage, or third-party-caused losses. Nothing in this clause excludes or limits liability that cannot lawfully be excluded, including non-waivable consumer rights, fraud, or willful misconduct where applicable.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">16. Termination</h3>
        <p className="mb-4 text-muted-foreground">We may suspend or terminate access if you breach these Terms, misuse the service, or create legal, security, or operational risks.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">17. Complaints</h3>
        <p className="mb-4 text-muted-foreground">Complaints may be sent to erentahiroglu@hotmail.com.tr. We aim, where reasonably possible, to provide an initial response within 5 business days, and a substantive response within 15 business days.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">18. Governing Law and Disputes</h3>
        <p className="mb-4 text-muted-foreground">These Terms are governed by the laws of the Republic of Türkiye, subject to mandatory consumer protection rules. Checkout, payment, and certain refund matters may also be subject to Paddle's applicable buyer terms. For consumers, mandatory jurisdiction and dispute-resolution rights remain unaffected. Consumers in Türkiye may apply to the Consumer Arbitration Committee or Consumer Court where applicable.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">19. Changes</h3>
        <p className="mb-4 text-muted-foreground">These Terms may be updated from time to time. The current version becomes effective when published on the website.</p>
      </div>
    </main>
    <Footer />
  </div>
);

export default TermsPage;
