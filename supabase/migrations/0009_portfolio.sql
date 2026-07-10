-- 0009_portfolio: public gallery of a barber's work photos.
-- No table — the gallery IS the set of objects under {barber_id}/ in a public bucket.
-- Public bucket => customers read via direct public URLs, no signing needed.

insert into storage.buckets (id, name, public) values ('portfolio', 'portfolio', true);

-- anyone signed in can list any barber's gallery (public storefront content)
create policy "portfolio_select" on storage.objects for select to authenticated
  using (bucket_id = 'portfolio');
-- a barber uploads/deletes only within their own folder
create policy "portfolio_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "portfolio_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text);
