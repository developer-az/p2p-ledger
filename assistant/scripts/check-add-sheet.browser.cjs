// Run with playwright-cli run-code --filename=assistant/scripts/check-add-sheet.browser.cjs on a local practice app.
async page => {
 await page.goto(new URL('/', page.url()).href);
 if (await page.getByRole('button', { name: 'Preview a sample household' }).count())
  await page.getByRole('button', { name: 'Preview a sample household' }).click();
 await page.getByRole('button',{name:'Add a spend or money in'}).waitFor();
 await page.getByRole('button',{name:'Add a spend or money in'}).click();
 await page.getByRole('textbox',{name:'Amount',exact:true}).fill('1.23');
 let release; const held=new Promise(r=>release=r); let writes=0;
 await page.route('**/api/accounts/*/spends',async route=>{if(route.request().method()==='POST'){writes++;await held;} await route.continue();});
 await page.getByRole('button',{name:'Dining',exact:true}).click();
 if(!await page.getByRole('radio',{name:'I got paid'}).isDisabled()) throw Error('Mode can change during save');
 await page.keyboard.press('Escape');
 if(!await page.getByRole('dialog').isVisible()) throw Error('Pending save dismissed');
 await page.locator('.add-form').evaluate(form=>form.requestSubmit());
 release();
 await page.getByRole('button',{name:'Undo',exact:true}).waitFor();
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.unroute('**/api/accounts/*/spends');
 if(writes!==1) throw Error('Duplicate writes: '+writes);
 return {pendingSaveLocked:true,duplicateWritesPrevented:true,writes};
}
