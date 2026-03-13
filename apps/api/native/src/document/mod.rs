pub mod model;
pub mod providers;
pub mod renderers;

pub use providers::factory::DocumentType;

use crate::document::model::Document;
use crate::document::providers::factory::ProviderFactory;
use crate::document::renderers::html::HtmlRenderer;
use crate::logging::{with_native_tracing, NativeContext, NativeLogEntry};
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Result of a traced document conversion, including captured logs.
#[napi(object)]
pub struct DocumentConvertResult {
  pub html: String,
  pub logs: Vec<NativeLogEntry>,
}

#[napi]
pub struct DocumentConverter {
  factory: ProviderFactory,
  html_renderer: HtmlRenderer,
}

impl Default for DocumentConverter {
  fn default() -> Self {
    Self::new()
  }
}

#[napi]
impl DocumentConverter {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      factory: ProviderFactory::new(),
      html_renderer: HtmlRenderer::new(),
    }
  }

  #[napi]
  pub fn convert_buffer_to_html(
    &self,
    data: &[u8],
    doc_type: DocumentType,
  ) -> napi::Result<String> {
    let provider = self.factory.get_provider(doc_type);

    let document: Document = provider
      .parse_buffer(data)
      .map_err(|e| Error::new(Status::GenericFailure, format!("Provider error: {e}")))?;

    let html = self.html_renderer.render(&document);
    Ok(html)
  }

  /// Convert a document buffer to HTML with structured tracing.
  /// Pass `ctx` (NativeContext) for logs tagged with scrape_id/url.
  #[napi]
  pub fn convert_buffer_to_html_traced(
    &self,
    data: &[u8],
    doc_type: DocumentType,
    ctx: Option<NativeContext>,
  ) -> napi::Result<DocumentConvertResult> {
    let factory = &self.factory;
    let renderer = &self.html_renderer;

    let traced = with_native_tracing(ctx.as_ref(), "document", || {
      tracing::info!(doc_type = ?doc_type, data_len = data.len(), "starting document conversion");

      let provider = factory.get_provider(doc_type);

      let document: Document = provider.parse_buffer(data).map_err(|e| {
        tracing::error!(error = %e, "document provider parse error");
        Error::new(Status::GenericFailure, format!("Provider error: {e}"))
      })?;

      let html = renderer.render(&document);
      tracing::info!(html_len = html.len(), "document conversion complete");
      Ok(html)
    })?;

    Ok(DocumentConvertResult {
      html: traced.value,
      logs: traced.logs,
    })
  }
}
