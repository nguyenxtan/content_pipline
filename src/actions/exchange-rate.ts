"use server";

export async function getUsdRateAction(): Promise<number> {
  try {
    const res = await fetch(
      "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx?b=10",
      { next: { revalidate: 300 } }
    );
    const xml = await res.text();
    const m = xml.match(/CurrencyCode="USD"[^>]*Transfer="([\d,]+\.?\d*)"/);
    if (!m) return 26162;
    return parseFloat(m[1].replace(/,/g, ""));
  } catch {
    return 26162;
  }
}
