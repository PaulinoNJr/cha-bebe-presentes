export function sanitizeHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html ?? ""), "text/html");

  doc.querySelectorAll("script,style,iframe,object").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
}
